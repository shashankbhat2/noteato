const { readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const resources = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  )

  for (const name of readdirSync(resources)) {
    if (name.endsWith('.lproj') && name !== 'en.lproj') {
      rmSync(join(resources, name), { recursive: true, force: true })
    }
  }
}
