import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

function writeOctal(buffer, value, offset, length) {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  buffer.write(encoded, offset, length, 'ascii');
}

function writeTarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function createTarGzip(packageName, version, dependencies = {}) {
  const packageJson = Buffer.from(JSON.stringify({
    name: packageName,
    version,
    main: 'index.js',
    dependencies,
  }));
  const entry = Buffer.from('module.exports = {}\n');
  const files = [
    ['package/package.json', packageJson],
    ['package/index.js', entry],
  ];
  const chunks = [];
  for (const [name, content] of files) {
    chunks.push(writeTarHeader(name, content.length), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function packageRecord(name, definition, baseUrl) {
  const version = definition.version;
  const tarball = createTarGzip(name, version, definition.dependencies);
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  const shasum = createHash('sha1').update(tarball).digest('hex');
  const versionMetadata = {
    name,
    version,
    dependencies: definition.dependencies ?? {},
    dist: {
      tarball: `${baseUrl}/tarballs/${encodeURIComponent(name)}/${encodeURIComponent(version)}.tgz`,
      integrity,
      shasum,
    },
  };
  const metadataTime = definition.publishedAt ?? '2020-01-01T00:00:00.000Z';
  const time = {
    created: metadataTime,
    modified: metadataTime,
  };
  if (definition.publishedAt !== null && definition.publishedAt !== undefined) {
    time[version] = definition.publishedAt;
  }
  return {
    name,
    version,
    'dist-tags': { latest: version },
    versions: { [version]: versionMetadata },
    time,
    tarball,
  };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

export async function createMockPackageRegistry(definitions) {
  const packages = new Map(Object.entries(definitions));
  const requests = [];
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    requests.push(decodedPath);

    if (request.method !== 'GET') {
      response.writeHead(405);
      response.end();
      return;
    }

    if (decodedPath.startsWith('/tarballs/')) {
      const [, , packageName, versionFile] = decodedPath.split('/');
      const version = versionFile?.replace(/\.tgz$/, '');
      const record = packages.get(packageName);
      if (!record || record.version !== version) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': record.tarball.length,
      });
      response.end(record.tarball);
      return;
    }

    const packageName = decodedPath.slice(1);
    const record = packages.get(packageName);
    if (!record) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    sendJson(response, 200, record);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  for (const [name, definition] of packages) {
    packages.set(name, packageRecord(name, definition, url));
  }

  return {
    url,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
