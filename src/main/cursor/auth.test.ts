/**
 * cursor auth 纯函数测试:userId 归一化、JWT 兜底、cookie 拼接。
 * (state.vscdb 读取的集成路径见 cursor.integration.test.ts)
 */
import { describe, expect, it } from 'vitest'
import { cursorSessionCookie, normalizeCursorSubject, userIdFromJwt } from './auth'

describe('normalizeCursorSubject', () => {
  it('原生 auth0 账号剥掉前缀', () => {
    expect(normalizeCursorSubject('auth0|user_01KMM0VXKX7H9ANY0FS4B1C1AK')).toBe(
      'user_01KMM0VXKX7H9ANY0FS4B1C1AK'
    )
  })

  it('WorkOS 桥接的 OAuth 主体原样保留', () => {
    expect(normalizeCursorSubject('google-oauth2|1187654321')).toBe('google-oauth2|1187654321')
    expect(normalizeCursorSubject('github|123456')).toBe('github|123456')
  })

  it('非 subject 形式返回 null', () => {
    expect(normalizeCursorSubject('bogus')).toBeNull()
    expect(normalizeCursorSubject('')).toBeNull()
    expect(normalizeCursorSubject(null)).toBeNull()
  })
})

describe('userIdFromJwt', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url')
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.fake-signature`
  }

  it('从 sub 解析 userId', () => {
    const jwt = makeJwt({ sub: 'auth0|user_01ABC', iat: 1 })
    expect(userIdFromJwt(jwt)).toBe('user_01ABC')
  })

  it('sub 不合法返回 null', () => {
    expect(userIdFromJwt(makeJwt({ sub: 'not-a-subject' }))).toBeNull()
    expect(userIdFromJwt('not-a-jwt')).toBeNull()
  })
})

describe('cursorSessionCookie', () => {
  it('拼成 WorkosCursorSessionToken=<userId>%3A%3A<jwt>', () => {
    expect(cursorSessionCookie({ userId: 'user_1', accessToken: 'tok' })).toBe(
      'WorkosCursorSessionToken=user_1%3A%3Atok'
    )
  })
})
