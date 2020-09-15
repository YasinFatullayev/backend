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
  let emails = []
  for (let i = 0; i < 101; i++) emails[i] = `${uuidv4()}${email}`

  await misc.sleep(2000)
  await expect(client.query({query: queries.findUsers, variables: {emails}})).rejects.toThrow(
    'GraphQL error: ServerError: Max 100 items per batch get request',
  )
})

test('Find users can handle duplicate emails', async () => {
  const {client} = await loginCache.getCleanLogin()
  const {userId: otherUserId, email: otherEmail, username: otherUsername} = await cognito.getAppSyncLogin()

  await misc.sleep(2000)
  await client
    .query({query: queries.findUsers, variables: {emails: [otherEmail, otherEmail]}})
    .then(({data: {findUsers}}) => {
      expect(findUsers.items).toHaveLength(1)
      expect(findUsers.items[0].userId).toBe(otherUserId)
      expect(findUsers.items[0].username).toBe(otherUsername)
    })
})

test('Find users by email', async () => {
  const {
    client: ourClient,
    userId: ourUserId,
    email: ourEmail,
    username: ourUsername,
  } = await cognito.getAppSyncLogin()

  const {userId: other1UserId, email: other1Email, username: other1Username} = await cognito.getAppSyncLogin()
  const {userId: other2UserId, email: other2Email, username: other2Username} = await cognito.getAppSyncLogin()
  const cmp = (a, b) => (a.userId < b.userId ? 1 : -1)

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}
  const other2 = {__typename: 'User', userId: other2UserId, username: other2Username}

  // find no users
  await expect(ourClient.query({query: queries.findUsers})).rejects.toThrow(
    'GraphQL error: ClientError: Called without any arguments... probably not what you intended?',
  )
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: ['x' + ourEmail]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([]))

  // find one user
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([other1]))
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, 'AA' + other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([us]))

  // find multiple users
  await misc.sleep(2000)
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
  } = await cognito.getAppSyncLogin()
  const theirPhone = '+15105551011'
  const {userId: theirUserId, email: theirEmail, username: theirUsername} = await cognito.getAppSyncLogin(
    theirPhone,
  )
  const cmp = (a, b) => (a.userId < b.userId ? 1 : -1)

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const them = {__typename: 'User', userId: theirUserId, username: theirUsername}

  // find them by just phone
  await ourClient
    .query({query: queries.findUsers, variables: {phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([them]))

  // find us and them by phone and email, make sure they don't duplicate
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, theirEmail], phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, them].sort(cmp)))
})

test('Find Users sends cards to the users that were found', async () => {
  const {
    client: ourClient,
    userId: ourUserId,
    email: ourEmail,
    username: ourUsername,
  } = await cognito.getAppSyncLogin()

  const {client: otherClient, userId: otherUserId, email: otherEmail} = await cognito.getAppSyncLogin()

  const {
    client: other1Client,
    userId: other1UserId,
    email: other1Email,
    username: other1Username,
  } = await cognito.getAppSyncLogin()

  const {client: other2Client, userId: other2UserId, email: other2Email} = await cognito.getAppSyncLogin()

  const randomEmail = `${uuidv4()}@real.app`

  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}

  // find One User
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [other1Email, randomEmail]}})
    .then(({data: {findUsers}}) => {
      // check with findusers
      expect(findUsers.items).toEqual([other1])
    })

  // check not-called user has no card
  await other2Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other2UserId)
    expect(self.cardCount).toBe(0)
  })

  // check called user has card
  const cardId = await other1Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other1UserId)
    expect(self.cardCount).toBe(1)
    const card = self.cards.items[0]
    expect(card.cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${ourUserId}`)
    expect(card.title).toBe(`${ourUsername} joined REAL`)
    expect(card.subTitle).toBeNull()
    expect(card.action).toBe(`https://real.app/user/${ourUserId}/`)
    return card.cardId
  })

  // dismiss the card
  await other1Client
    .mutate({mutation: mutations.deleteCard, variables: {cardId}})
    .then(({data}) => expect(data.deleteCard.cardId).toBe(cardId))

  // find different Users with new user
  await misc.sleep(2000)
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, other1Email, other2Email]}})
    .then(({data: {findUsers}}) => {
      expect(findUsers.items.map((item) => item.userId).sort()).toEqual(
        [ourUserId, other1UserId, other2UserId].sort(),
      )
    })
  // check first called user has card
  await other1Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other1UserId)
    expect(self.cards.items[0].cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${ourUserId}`)
  })
  // check second called user has card
  await other2Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other2UserId)
    expect(self.cards.items[0].cardId).toBe(`${other2UserId}:NEW_FOLLOWER:${ourUserId}`)
  })

  // find different Users with other new user
  await misc.sleep(2000)
  await otherClient
    .query({query: queries.findUsers, variables: {emails: [otherEmail, other1Email, other2Email]}})
    .then(({data: {findUsers}}) => {
      expect(findUsers.items.map((item) => item.userId).sort()).toEqual(
        [otherUserId, other1UserId, other2UserId].sort(),
      )
    })
  // check first called user has card
  await other1Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other1UserId)
    expect(self.cards.items[0].cardId).toBe(`${other1UserId}:NEW_FOLLOWER:${otherUserId}`)
  })
  // check second called user has card
  await other2Client.query({query: queries.self}).then(({data: {self}}) => {
    expect(self.userId).toBe(other2UserId)
    expect(self.cards.items[0].cardId).toBe(`${other2UserId}:NEW_FOLLOWER:${otherUserId}`)
  })
})
