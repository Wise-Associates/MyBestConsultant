import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isLogoFileUrl } from './brand'

const endpoint = 'https://appwrite.example.com/v1'
const ok = `${endpoint}/storage/buckets/logos/files/abc123/view?project=demo-project`

describe('logo d\'une organisation', () => {
  it('accepte un fichier du bucket des logos du projet', () => {
    assert.equal(isLogoFileUrl(ok, endpoint, 'logos'), true)
    assert.equal(isLogoFileUrl(`${endpoint}/storage/buckets/logos/files/abc123/view`, endpoint, 'logos'), true)
  })

  it('refuse une adresse d\'un autre site, d\'un autre bucket ou d\'une autre route', () => {
    assert.equal(isLogoFileUrl('https://tracker.example/p.gif', endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl(`${endpoint}/storage/buckets/cv/files/abc123/view`, endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl(`${endpoint}/storage/buckets/logos/files/abc123/download`, endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl('http://appwrite.example.com/v1/storage/buckets/logos/files/abc123/view', endpoint, 'logos'), false)
  })

  it('résout les « .. », même encodés, avant de comparer', () => {
    assert.equal(isLogoFileUrl(`${endpoint}/storage/buckets/logos/files/%2e%2e/%2e%2e/cv/files/x/view`, endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl(`${endpoint}/storage/buckets/logos/files/../../cv/files/x/view`, endpoint, 'logos'), false)
  })

  it('refuse des paramètres, un fragment ou des identifiants ajoutés', () => {
    assert.equal(isLogoFileUrl(`${ok}&mode=admin`, endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl(`${ok}#x`, endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl('https://user:pw@appwrite.example.com/v1/storage/buckets/logos/files/abc123/view', endpoint, 'logos'), false)
    assert.equal(isLogoFileUrl('pas une adresse', endpoint, 'logos'), false)
  })
})
