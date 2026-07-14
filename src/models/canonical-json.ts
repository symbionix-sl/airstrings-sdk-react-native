import { StringBundle } from './string-bundle'

export function signedContent(bundle: StringBundle): Uint8Array {
  let json = '{'
  json += '"format_version":' + String(bundle.format_version)
  json += ',"project_id":' + escapeString(bundle.project_id)
  json += ',"locale":' + escapeString(bundle.locale)
  json += ',"revision":' + String(bundle.revision)
  json += ',"created_at":' + escapeString(bundle.created_at)
  json += ',"strings":{'

  const sortedKeys = Object.keys(bundle.strings).sort()
  for (let i = 0; i < sortedKeys.length; i++) {
    if (i > 0) json += ','
    const entry = bundle.strings[sortedKeys[i]!]!
    json += escapeString(sortedKeys[i]!) + ':{"format":' + escapeString(entry.format) + ',"value":' + escapeString(entry.value) + '}'
  }

  json += '}}'
  return utf8Encode(json)
}

export function experimentsSignedContent(bundle: StringBundle): Uint8Array {
  let json = '{'
  json += '"format_version":' + String(bundle.format_version)
  json += ',"project_id":' + escapeString(bundle.project_id)
  json += ',"locale":' + escapeString(bundle.locale)
  json += ',"revision":' + String(bundle.revision)
  json += ',"created_at":' + escapeString(bundle.created_at)
  json += ',"experiments":{'

  const experimentKeys = Object.keys(bundle.strings)
    .filter((key) => bundle.strings[key]!.experiment !== undefined)
    .sort()
  for (let i = 0; i < experimentKeys.length; i++) {
    if (i > 0) json += ','
    const experiment = bundle.strings[experimentKeys[i]!]!.experiment!
    json += escapeString(experimentKeys[i]!) + ':{"allocation":{'

    const allocationKeys = Object.keys(experiment.allocation).sort()
    for (let j = 0; j < allocationKeys.length; j++) {
      if (j > 0) json += ','
      json += escapeString(allocationKeys[j]!) + ':' + String(experiment.allocation[allocationKeys[j]!])
    }
    json += '},"id":' + escapeString(experiment.id) + ',"variants":{'

    const variantKeys = Object.keys(experiment.variants).sort()
    for (let j = 0; j < variantKeys.length; j++) {
      if (j > 0) json += ','
      json += escapeString(variantKeys[j]!) + ':' + escapeString(experiment.variants[variantKeys[j]!]!)
    }
    json += '}}'
  }

  json += '}}'
  return utf8Encode(json)
}

function escapeString(s: string): string {
  let result = '"'
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    switch (code) {
      case 0x22:
        result += '\\"'
        break
      case 0x5c:
        result += '\\\\'
        break
      case 0x08:
        result += '\\b'
        break
      case 0x0c:
        result += '\\f'
        break
      case 0x0a:
        result += '\\n'
        break
      case 0x0d:
        result += '\\r'
        break
      case 0x09:
        result += '\\t'
        break
      default:
        if (code < 0x20) {
          result += '\\u' + code.toString(16).padStart(4, '0')
        } else {
          result += s[i]
        }
    }
  }
  result += '"'
  return result
}

export function utf8Encode(s: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i)!
    if (code > 0xffff) i++
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}
