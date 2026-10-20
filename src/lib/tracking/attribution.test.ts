import { describe, expect, it } from 'vitest'
import {
  classifySession,
  cleanSessionParams,
  extractSessionCode,
  fromReferral,
  fromSession,
  hasSignal,
  isCtwaReferral,
  isValidSessionCode,
  stripSessionCode,
} from './attribution'

describe('session code in the first message', () => {
  it('finds the code and uppercases it', () => {
    expect(extractSessionCode('Olá, vim pelo site [#a1b2c3d4]')).toBe('A1B2C3D4')
  })

  it('works when the code is on its own line', () => {
    expect(extractSessionCode('Quero saber mais\n[#K9Z8X7W6]')).toBe('K9Z8X7W6')
  })

  it.each([null, undefined, '', 'sem código', '#A1B2C3D4', '[#abc]', '[#abc def ghi]'])(
    'ignores %j',
    (text) => {
      expect(extractSessionCode(text)).toBeNull()
    },
  )

  it('strips the code and trailing spaces', () => {
    expect(stripSessionCode('Olá, vim pelo site [#A1B2C3D4]')).toBe('Olá, vim pelo site')
  })
})

describe('classifySession', () => {
  it('gclid means Google', () => {
    expect(classifySession({ gclid: 'abc' })).toBe('google')
  })
  it('utm_source google means Google', () => {
    expect(classifySession({ utm_source: 'Google' })).toBe('google')
  })
  it('fbclid means Meta', () => {
    expect(classifySession({ fbclid: 'xyz' })).toBe('meta_site')
  })
  it.each(['facebook', 'instagram', 'ig', 'meta'])('utm_source %s means Meta', (utm) => {
    expect(classifySession({ utm_source: utm })).toBe('meta_site')
  })
  it('unknown utm is other', () => {
    expect(classifySession({ utm_source: 'newsletter' })).toBe('other')
  })
  it('google click id wins over a facebook click id', () => {
    expect(classifySession({ gclid: 'a', fbclid: 'b' })).toBe('google')
  })
})

describe('hasSignal', () => {
  it('false for a direct visit', () => {
    expect(hasSignal({ landing_url: 'https://x.com/', referrer: 'https://google.com/' })).toBe(false)
  })
  it('true with any campaign param', () => {
    expect(hasSignal({ utm_campaign: 'black' })).toBe(true)
    expect(hasSignal({ gclid: 'a' })).toBe(true)
  })
})

describe('cleanSessionParams', () => {
  it('trims, bounds and nulls empty or non-string values', () => {
    const out = cleanSessionParams({
      utm_source: '  google  ',
      utm_campaign: 'x'.repeat(500),
      gclid: '',
      fbclid: 42,
    })
    expect(out.utm_source).toBe('google')
    expect(out.utm_campaign).toHaveLength(200)
    expect(out.gclid).toBeNull()
    expect(out.fbclid).toBeNull()
  })
})

describe('referral', () => {
  it('accepts an ad referral', () => {
    expect(isCtwaReferral({ source_id: '123', ctwa_clid: 'AbC' })).toBe(true)
  })
  it.each([null, undefined, 'x', {}, { headline: 'só texto' }])('rejects %j', (r) => {
    expect(isCtwaReferral(r)).toBe(false)
  })
  it('maps fields', () => {
    expect(
      fromReferral({ source_id: '99', ctwa_clid: 'c', headline: 'Oferta', source_type: 'ad' }),
    ).toMatchObject({ source: 'meta_ctwa', ad_id: '99', ctwa_clid: 'c', headline: 'Oferta' })
  })
})

describe('fromSession', () => {
  it('maps params and source', () => {
    expect(fromSession('ABCD1234', { gclid: 'g', utm_campaign: 'c1' })).toMatchObject({
      source: 'google',
      session_code: 'ABCD1234',
      gclid: 'g',
      utm_campaign: 'c1',
    })
  })
})

describe('isValidSessionCode', () => {
  it('accepts only uppercase alphanumerics of 6 to 12 chars', () => {
    expect(isValidSessionCode('A1B2C3D4')).toBe(true)
    expect(isValidSessionCode('a1b2c3d4')).toBe(false)
    expect(isValidSessionCode('ABC')).toBe(false)
    expect(isValidSessionCode('AB-CD-EF')).toBe(false)
    expect(isValidSessionCode(12345678)).toBe(false)
  })
})
