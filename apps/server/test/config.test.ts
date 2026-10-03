import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('treats empty variables as unset (docker compose passes `${VAR:-}` as "")', () => {
    const config = loadConfig({
      S3_ENDPOINT: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      ATTACHMENT_STORAGE: 'volume',
      ALLOW_REGISTRATION: 'false',
    })
    expect(config.attachments.s3).toBeUndefined()
    expect(config.allowRegistration).toBe(false)
  })
})
