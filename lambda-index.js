const { DynamoDBClient, ScanCommand, PutItemCommand, DeleteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const dynamo = new DynamoDBClient({ region: 'eu-west-1' });
const s3     = new S3Client({ region: 'eu-west-1' });

const LIBRARY_TABLE  = 'whitelist-library';
const CONFIG_TABLE   = 'whitelist-config';
const MEDIA_BUCKET   = 'whitelist-site-media';
const ALLOWED_ORIGIN = 'https://d2kcfj0inhoopv.cloudfront.net';

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type,X-Session-Token',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Content-Type': 'application/json'
};

async function getConfig(key) {
  const res = await dynamo.send(new QueryCommand({
    TableName: CONFIG_TABLE,
    KeyConditionExpression: '#k = :k',
    ExpressionAttributeNames: { '#k': 'key' },
    ExpressionAttributeValues: { ':k': { S: key } }
  }));
  return res.Items?.[0]?.value?.S || null;
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

exports.handler = async (event) => {
  const method  = event.requestContext?.http?.method || event.httpMethod || '';
  const rawPath = event.rawPath || event.path || '';
  const path    = rawPath.replace(/^\/prod/, '');

  if (method === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (method === 'POST' && path === '/login') {
    try {
      const body         = JSON.parse(event.body || '{}');
      const passwordHash = await getConfig('password_hash');
      const apiSecret    = await getConfig('api_secret');
      if (!passwordHash || !apiSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
      const incoming = sha256(body.password || '');
      if (incoming !== passwordHash) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };
      const ts    = Date.now().toString();
      const token = crypto.createHmac('sha256', apiSecret).update(ts).digest('hex');
      return { statusCode: 200, headers, body: JSON.stringify({ token: `${ts}.${token}` }) };
    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  const sessionToken = event.headers?.['x-session-token'] || '';
  try {
    const apiSecret = await getConfig('api_secret');
    if (!apiSecret) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfigured' }) };
    const [ts, token] = sessionToken.split('.');
    if (!ts || !token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (Date.now() - parseInt(ts) > 86400000) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Session expired' }) };
    const expected = crypto.createHmac('sha256', apiSecret).update(ts).digest('hex');
    const tokBuf = Buffer.from(token.padEnd(64, '0'));
    const expBuf = Buffer.from(expected.padEnd(64, '0'));
    if (!crypto.timingSafeEqual(tokBuf, expBuf)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    if (method === 'GET' && path === '/library') {
      const res   = await dynamo.send(new ScanCommand({ TableName: LIBRARY_TABLE }));
      const items = (res.Items || []).map(i => ({
        id: i.id?.S, src: i.src?.S, type: i.type?.S, title: i.title?.S, created_at: i.created_at?.S
      })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { statusCode: 200, headers, body: JSON.stringify(items) };
    }

    if (method === 'POST' && path === '/library') {
      const body = JSON.parse(event.body || '{}');
      await dynamo.send(new PutItemCommand({
        TableName: LIBRARY_TABLE,
        Item: {
          id:         { S: body.id },
          src:        { S: body.src   || '' },
          type:       { S: body.type  || 'audio' },
          title:      { S: body.title || '' },
          created_at: { S: new Date().toISOString() }
        }
      }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (method === 'DELETE' && path.startsWith('/library/')) {
      const id = path.split('/library/')[1];
      await dynamo.send(new DeleteItemCommand({ TableName: LIBRARY_TABLE, Key: { id: { S: id } } }));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (method === 'DELETE' && path === '/library') {
      const res = await dynamo.send(new ScanCommand({ TableName: LIBRARY_TABLE }));
      await Promise.all((res.Items || []).map(item =>
        dynamo.send(new DeleteItemCommand({ TableName: LIBRARY_TABLE, Key: { id: { S: item.id.S } } }))
      ));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (method === 'POST' && path === '/upload-url') {
      const body    = JSON.parse(event.body || '{}');
      const command = new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: body.filename, ContentType: body.mimetype });
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
      const publicUrl = `https://whitelist-site-media.s3.eu-west-1.amazonaws.com/${body.filename}`;
      return { statusCode: 200, headers, body: JSON.stringify({ uploadUrl, publicUrl }) };
    }

    if (method === 'GET' && path === '/storage-stats') {
      let totalSize = 0;
      let totalCount = 0;
      let continuationToken = undefined;

      do {
        const res = await s3.send(new ListObjectsV2Command({
          Bucket: MEDIA_BUCKET,
          ContinuationToken: continuationToken
        }));
        (res.Contents || []).forEach(obj => { totalSize += obj.Size; totalCount++; });
        continuationToken = res.NextContinuationToken;
      } while (continuationToken);

      const FREE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          fileCount: totalCount,
          totalBytes: totalSize,
          freeLimitBytes: FREE_LIMIT_BYTES,
          percentUsed: Math.round((totalSize / FREE_LIMIT_BYTES) * 1000) / 10
        })
      };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found', path, method }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};