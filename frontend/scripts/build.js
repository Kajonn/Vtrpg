const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const buildDir = path.join(__dirname, '..', 'build');

fs.mkdirSync(buildDir, { recursive: true });

const indexSrc = path.join(srcDir, 'index.html');
const indexDst = path.join(buildDir, 'index.html');

const html = fs.readFileSync(indexSrc, 'utf-8');
const stamped = html.replace('__BUILD_TIME__', new Date().toISOString());

fs.writeFileSync(indexDst, stamped);
console.log(`Built static assets into ${buildDir}`);
