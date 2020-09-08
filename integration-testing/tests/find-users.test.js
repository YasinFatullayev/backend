const cognito = require('../utils/cognito')
const misc = require('../utils/misc')
const {queries, mutations} = require('../schema')
const uuidv4 = require('uuid/v4')

const loginCache = new cognito.AppSyncLoginCache()
jest.retryTimes(2)

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.reset())

test('Find users by email & phoneNumber too many', async () => {
  const {client, email} = await loginCache.getCleanLogin()
  const emails = Array(101).fill(email)
  await misc.sleep(2000)
  await expect(client.query({query: queries.findUsers, variables: {emails}})).rejects.toThrow(
    /Cannot submit more than 100 combined emails and phoneNumbers/,
  )
})

test('Find users can handle duplicate emails', async () => {
  const {client, userId, email, username} = await loginCache.getCleanLogin()
  await misc.sleep(2000)
  await client
    .query({query: queries.findUsers, variables: {emails: [email, email]}})
    .then(({data: {findUsers}}) => {
      expect(findUsers.items).toHaveLength(1)
      expect(findUsers.items[0].userId).toBe(userId)
      expect(findUsers.items[0].username).toBe(username)
    })
})

test('Find users by email', async () => {
  const {
    client: ourClient,
    userId: ourUserId,
    email: ourEmail,
    username: ourUsername,
  } = await loginCache.getCleanLogin()
  const {userId: other1UserId, email: other1Email, username: other1Username} = await loginCache.getCleanLogin()
  const {userId: other2UserId, email: other2Email, username: other2Username} = await loginCache.getCleanLogin()
  const cmp = (a, b) => a.userId < b.userId

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}
  const other2 = {__typename: 'User', userId: other2UserId, username: other2Username}

  // find no users
  await misc.sleep(2000)
  await ourClient.query({query: queries.findUsers}).then(({data: {findUsers}}) => {
    expect(findUsers.items).toEqual([])
    expect(findUsers.nextToken).toBe(null)
  })
  await ourClient
    .query({query: queries.findUsers, variables: {emails: ['x' + ourEmail]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([]))

  // find one user
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([other1]))
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, 'AA' + other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([us]))

  // find multiple users
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, other1Email, other2Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, other1, other2].sort(cmp)))
})

test('Find users by phone, and by phone and email', async () => {
  const {
    client: ourClient,
    userId: ourUserId,
    email: ourEmail,
    username: ourUsername,
  } = await loginCache.getCleanLogin()
  const theirPhone = '+15105551011'
  const {userId: theirUserId, email: theirEmail, username: theirUsername} = await cognito.getAppSyncLogin(
    theirPhone,
  )
  const cmp = (a, b) => a.userId < b.userId

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const them = {__typename: 'User', userId: theirUserId, username: theirUsername}

  // find them by just phone
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([them]))

  // find us and them by phone and email, make sure they don't duplicate
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, theirEmail], phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, them].sort(cmp)))
})

test('Find Users and test with cards', async () => {
  const {
    client: ourClient,
    userId: ourUserId,
    email: ourEmail,
    username: ourUsername,
  } = await loginCache.getCleanLogin()

  const {
    client: otherClient,
    userId: otherUserId,
    email: otherEmail,
    username: otherUsername,
  } = await loginCache.getCleanLogin()

  const {
    client: firstClient,
    userId: other1UserId,
    email: other1Email,
    username: other1Username,
  } = await loginCache.getCleanLogin()

  const {
    client: secondClient,
    userId: other2UserId,
    email: other2Email,
    username: other2Username,
  } = await loginCache.getCleanLogin()

  const randomId = uuidv4()
  const randomEmail = `${randomId}@real.app`

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const other = {__typename: 'User', userId: otherUserId, username: otherUsername}
  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}
  const other2 = {__typename: 'User', userId: other2UserId, username: other2Username}

  // find One Users
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [other1Email, randomEmail]}})
    .then(async ({data: {findUsers}}) => {
      // check with findusers
      expect(findUsers.items[0]).toEqual(other1)

      // check not-called user has no card
      await secondClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other2UserId)
        expect(data.self.cardCount).toBe(0)
      })

      // check called user has card
      const cardId = await firstClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other1UserId)
        expect(data.self.cardCount).toBe(0)
        const card = data.self.cards.items[0]
        expect(card.title).toBe(`${ourUsername} joined REAL`)
        expect(card.cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${ourUserId}`)
        return card.cardId
      })

      // dismiss the card
      await firstClient
        .mutate({mutation: mutations.deleteCard, variables: {cardId}})
        .then(({data}) => expect(data.deleteCard.cardId).toBe(cardId))
    })

  // find different Users
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, other1Email, other2Email]}})
    .then(async ({data: {findUsers}}) => {
      expect(findUsers.items).toBe([us, other1, other2])

      // Check called user has card
      await firstClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other1UserId)
        const card = data.self.cards.items[0]
        expect(card.cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${ourUserId}`)
      })
      await secondClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other2UserId)
        const card = data.self.cards.items[0]
        expect(card.cardId).toBe(`${other2UserId}:NEW_FOLLOWER:${ourUserId}`)
      })
    })

  await otherClient
    .query({query: queries.findUsers, variables: {emails: [otherEmail, other1Email, other2Email]}})
    .then(async ({data: {findUsers}}) => {
      expect(findUsers.items).toBe([other, other1, other2])

      // Check called user has card
      await firstClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other1UserId)
        const card = data.self.cards.items[0]
        expect(card.cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${otherUserId}`)
      })
      await secondClient.query({query: queries.self}).then(({data}) => {
        expect(data.self.userId).toBe(other2UserId)
        const card = data.self.cards.items[0]
        expect(card.cardId).toBe(`${other2UserId}:NEW_FOLLOWER:${otherUserId}`)
      })
    })
})
