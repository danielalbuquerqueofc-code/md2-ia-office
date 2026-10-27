// Prints an operator credential (scrypt salt + hash) for the MD2 operators file.
// The secret is read from stdin so it never appears in shell history or process arguments,
// and it is never written anywhere. Same parameters as hashOperatorSecret (N=32768, r=8, p=1).
const { randomBytes, scryptSync } = require('node:crypto');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const secret = input.replace(/\r?\n$/, '');
  if (secret.length < 12 || secret.length > 1024) {
    process.stderr.write('O segredo precisa ter entre 12 e 1024 caracteres.\n');
    process.exitCode = 1;
    return;
  }
  const N = 32768;
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 });
  process.stdout.write(
    JSON.stringify(
      {
        algorithm: 'scrypt',
        N,
        r: 8,
        p: 1,
        salt: salt.toString('base64'),
        hash: hash.toString('base64'),
      },
      null,
      2,
    ) + '\n',
  );
});
