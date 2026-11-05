/**
 * Device metadata extraction from stored session JSON.
 * Approximate device/browser info only — no raw IPs stored (hashed), no town-level
 * location; country-only if a future geo hook is configured.
 */

export interface DeviceSummary {
  browser: string
  os: string
  deviceType: string
}

export function deviceInfoFor(deviceInfo: unknown): DeviceSummary {
  const ua = (deviceInfo as { userAgent?: string }).userAgent ?? ''
  return parseUserAgent(ua)
}

export function parseUserAgent(ua: string): DeviceSummary {
  let browser = 'Unknown browser'
  let os = 'Unknown OS'
  let deviceType = 'Desktop'

  if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua)) browser = 'Safari'

  if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os|macintosh/i.test(ua)) os = 'macOS'
  else if (/iphone/i.test(ua)) os = 'iOS'
  else if (/ipad/i.test(ua)) os = 'iPadOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/linux/i.test(ua)) os = 'Linux'

  if (/iphone|android.+mobile|windows phone/i.test(ua)) deviceType = 'Mobile'
  else if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) deviceType = 'Tablet'

  return { browser, os, deviceType }
}
