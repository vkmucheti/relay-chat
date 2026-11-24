import { existsSync } from 'node:fs';
if (process.env.HUSKY !== '0' && existsSync('.git')) {
  const { default: install } = await import('husky');
  const result = install();
  if (result) console.log(result);
}
