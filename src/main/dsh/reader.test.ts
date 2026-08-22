import { describe, expect, it } from 'vitest'
import { zstdCompressSync } from 'node:zlib'
import { decompressFrames, parseSessionEvents } from './reader'

/** 构造多帧 zstd:每个 chunk 一帧,拼接(模拟 session.jsonl.zstd) */
function packFrames(chunks: string[]): Buffer {
  return Buffer.concat(chunks.map((c) => zstdCompressSync(Buffer.from(c, 'utf8'))))
}

const SESSION_HEADER = '{"type":"session","id":"session-x","version":0,"createdAt":1786631451837}\n'
const HEADER_A =
  '{"type":"request/header","seq":1,"time":1786668290000,"data":{"header":{"config":{"provider":"opencode-go","model":"deepseek-v4-flash"}}}}\n'
const HEADER_B =
  '{"type":"request/header","seq":10,"time":1786668299000,"data":{"header":{"config":{"provider":"deepseek-official","model":"deepseek-v4-pro"}}}}\n'
const USAGE_1 =
  '{"type":"assistant/chunk","seq":2,"time":1786668299417,"data":{"turn":1,"step":1,"chunk":{"type":"usage","usage":{"inputTokens":6324,"outputTokens":235,"cacheReadTokens":6912}}}}\n'
// cacheReadTokens 整键缺席
const USAGE_2 =
  '{"type":"assistant/chunk","seq":11,"time":1786668302148,"data":{"turn":1,"step":2,"chunk":{"type":"usage","usage":{"inputTokens":46,"outputTokens":118}}}}\n'
const NOISE = '{"type":"assistant/chunk","seq":3,"time":1786668300000,"data":{"turn":1,"step":1,"chunk":{"type":"text","text":"hi"}}}\n'

describe('decompressFrames', () => {
  it('decompresses multi-frame concatenated zstd', () => {
    const buf = packFrames([SESSION_HEADER + HEADER_A, USAGE_1 + NOISE, USAGE_2])
    const text = decompressFrames(buf)
    expect(text).toBe(SESSION_HEADER + HEADER_A + USAGE_1 + NOISE + USAGE_2)
  })

  it('returns null when no frame magic found', () => {
    expect(decompressFrames(Buffer.from('plain jsonl, not zstd'))).toBeNull()
  })

  it('tolerates a truncated tail frame and keeps prior content', () => {
    const good = packFrames([SESSION_HEADER, USAGE_1])
    const tail = zstdCompressSync(Buffer.from(USAGE_2, 'utf8'))
    const truncated = Buffer.concat([good, tail.subarray(0, Math.max(10, tail.length - 4))])
    const text = decompressFrames(truncated)
    expect(text).not.toBeNull()
    expect(text).toContain(USAGE_1.trim())
  })
})

describe('parseSessionEvents', () => {
  it('extracts usage events with model attribution from nearest preceding request/header', () => {
    const text = SESSION_HEADER + HEADER_A + USAGE_1 + NOISE + HEADER_B + USAGE_2
    const { events, versionOk } = parseSessionEvents(text)
    expect(versionOk).toBe(true)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      inputTokens: 6324,
      outputTokens: 235,
      cacheReadTokens: 6912
    })
    // seq 11 在 HEADER_B(seq 10)之后 → 归属 deepseek-v4-pro;cacheRead 缺席 → 0
    expect(events[1]).toMatchObject({
      model: 'deepseek-v4-pro',
      inputTokens: 46,
      outputTokens: 118,
      cacheReadTokens: 0
    })
  })

  it('flags unknown session schema version', () => {
    const text = '{"type":"session","id":"s","version":1}\n' + HEADER_A + USAGE_1
    const { events, versionOk } = parseSessionEvents(text)
    expect(versionOk).toBe(false)
    expect(events).toHaveLength(1) // 事件仍解析,是否采用由调用方决定
  })

  it('attributes usage before any header to unknown', () => {
    const { events } = parseSessionEvents(SESSION_HEADER + USAGE_1)
    expect(events[0].model).toBe('unknown')
  })

  it('skips malformed lines without failing the file', () => {
    const text = SESSION_HEADER + 'not-json\n' + HEADER_A + USAGE_1
    expect(parseSessionEvents(text).events).toHaveLength(1)
  })
})
