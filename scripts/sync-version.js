const fs = require('fs')
const path = require('path')

const pkg     = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version

const confPath = path.join('src-tauri', 'tauri.conf.json')
let conf = fs.readFileSync(confPath, 'utf8')

// Update version field
conf = conf.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)

// Update window title
conf = conf.replace(/"title":\s*"MARK [^"]*— Review App"/, `"title": "MARK ${version} — Review App"`)

fs.writeFileSync(confPath, conf)
console.log(`[sync-version] tauri.conf.json updated → v${version}`)
