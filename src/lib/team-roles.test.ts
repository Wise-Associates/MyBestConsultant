import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { adminUserIdsOf, filterTeam, roleOf, teamActionDenial, withRole, type TeamTarget } from './team-roles'

const member = (over: Partial<TeamTarget> = {}): TeamTarget => ({ role: 'member', status: 'active', isSelf: false, ...over })

describe('rôles dans l\'organisation', () => {
  it('lit le propriétaire et les administrateurs de l\'organisation', () => {
    const tenant = { recruiterId: 'u-owner', adminUserIds: ['u-admin'] }
    assert.equal(roleOf('u-owner', tenant), 'owner')
    assert.equal(roleOf('u-admin', tenant), 'admin')
    assert.equal(roleOf('u-other', tenant), 'member')
    assert.equal(roleOf('u-admin', { recruiterId: 'u-owner' }), 'member')
  })

  it('laisse inviter et modifier l\'organisation au propriétaire et aux administrateurs', () => {
    assert.equal(teamActionDenial('owner', 'invite'), null)
    assert.equal(teamActionDenial('admin', 'editOrganisation'), null)
    assert.notEqual(teamActionDenial('member', 'invite'), null)
    assert.notEqual(teamActionDenial('member', 'editOrganisation'), null)
  })

  it('réserve la facturation, les rôles et le transfert au propriétaire', () => {
    assert.equal(teamActionDenial('owner', 'billing'), null)
    assert.notEqual(teamActionDenial('admin', 'billing'), null)
    assert.equal(teamActionDenial('owner', 'setRole', member()), null)
    assert.notEqual(teamActionDenial('admin', 'setRole', member()), null)
    assert.equal(teamActionDenial('owner', 'transfer', member({ role: 'admin' })), null)
    assert.notEqual(teamActionDenial('admin', 'transfer', member()), null)
  })

  it('refuse un rôle ou un transfert vers un compte inactif', () => {
    assert.notEqual(teamActionDenial('owner', 'transfer', member({ status: 'pending' })), null)
    assert.notEqual(teamActionDenial('owner', 'setRole', member({ status: 'disabled' })), null)
  })

  it('ne touche jamais au propriétaire ni à son propre compte', () => {
    for (const action of ['remove', 'disable', 'setRole', 'transfer', 'resend'] as const) {
      assert.notEqual(teamActionDenial('owner', action, member({ role: 'owner' })), null, action)
      assert.notEqual(teamActionDenial('owner', action, member({ isSelf: true })), null, action)
    }
  })

  it('laisse un administrateur gérer les membres, pas les autres administrateurs', () => {
    assert.equal(teamActionDenial('admin', 'remove', member()), null)
    assert.equal(teamActionDenial('admin', 'disable', member()), null)
    assert.notEqual(teamActionDenial('admin', 'remove', member({ role: 'admin' })), null)
    assert.notEqual(teamActionDenial('member', 'remove', member()), null)
  })

  it('vérifie l\'état du compte visé', () => {
    assert.equal(teamActionDenial('owner', 'resend', member({ status: 'pending' })), null)
    assert.notEqual(teamActionDenial('owner', 'resend', member()), null)
    assert.notEqual(teamActionDenial('owner', 'disable', member({ status: 'pending' })), null)
    assert.equal(teamActionDenial('owner', 'enable', member({ status: 'disabled' })), null)
    assert.notEqual(teamActionDenial('owner', 'enable', member()), null)
    assert.equal(teamActionDenial('owner', 'remove', member({ status: 'pending' })), null)
  })

  it('lit la liste des administrateurs, ou son absence en base', () => {
    assert.equal(adminUserIdsOf({ recruiterId: 'u-owner' }), null)
    assert.deepEqual(adminUserIdsOf({ adminUserIds: null }), [])
    assert.deepEqual(adminUserIdsOf({ adminUserIds: ['a', 3, 'b'] }), ['a', 'b'])
  })

  it('met à jour la liste des administrateurs sans doublon', () => {
    assert.deepEqual(withRole(['a', 'b'], 'c', 'admin'), ['a', 'b', 'c'])
    assert.deepEqual(withRole(['a', 'b'], 'a', 'admin'), ['b', 'a'])
    assert.deepEqual(withRole(['a', 'b'], 'a', 'member'), ['b'])
  })

  it('filtre la liste par recherche, état et rôle', () => {
    const list = [
      { firstName: 'Élodie', lastName: 'Martin', email: 'e.martin@example.com', role: 'owner' as const, status: 'active' as const },
      { firstName: 'Paul', lastName: 'Durand', email: 'p.durand@example.com', role: 'member' as const, status: 'pending' as const },
    ]
    assert.deepEqual(filterTeam(list, { query: 'elodie', status: 'all', role: 'all' }).map(m => m.firstName), ['Élodie'])
    assert.deepEqual(filterTeam(list, { query: '', status: 'pending', role: 'all' }).map(m => m.firstName), ['Paul'])
    assert.deepEqual(filterTeam(list, { query: 'example', status: 'all', role: 'owner' }).map(m => m.firstName), ['Élodie'])
  })
})
