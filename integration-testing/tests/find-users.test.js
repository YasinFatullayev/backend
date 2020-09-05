const cognito = require('../utils/cognito')
const misc = require('../utils/misc')
const {queries, mutations} = require('../schema')

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

  // Test with Query
  await expect(client.query({query: queries.findUsers, variables: {emails}})).rejects.toThrow(
    /Cannot submit more than 100 combined emails and phoneNumbers/,
  )
  // Test with Mutation
  await expect(client.mutate({mutation: mutations.findUsers, variables: {emails}})).rejects.toThrow(
    /Cannot submit more than 100 combined emails and phoneNumbers/,
  )
})

test('Find users can handle duplicate emails', async () => {
  const {client, userId, email, username} = await loginCache.getCleanLogin()
  await misc.sleep(2000)

  // Test with Query
  await client
    .query({query: queries.findUsers, variables: {emails: [email, email]}})
    .then(({data: {findUsers}}) => {
      expect(findUsers.items).toHaveLength(1)
      expect(findUsers.items[0].userId).toBe(userId)
      expect(findUsers.items[0].username).toBe(username)
    })
  // Test with Mutation
  await client
    .mutate({mutations: mutations.findUsers, variables: {emails: [email, email]}})
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

  // How each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}
  const other2 = {__typename: 'User', userId: other2UserId, username: other2Username}

  // Find no users
  await misc.sleep(2000)
  // Test with Query
  await ourClient.query({query: queries.findUsers}).then(({data: {findUsers}}) => {
    expect(findUsers.items).toEqual([])
    expect(findUsers.nextToken).toBe(null)
  })
  await ourClient
    .query({query: queries.findUsers, variables: {emails: ['x' + ourEmail]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([]))
  // Test with Mutation
  await ourClient.mutate({mutation: mutations.findUsers}).then(({data: {findUsers}}) => {
    expect(findUsers.items).toEqual([])
    expect(findUsers.nextToken).toBe(null)
  })
  await ourClient
    .mutate({mutation: mutations.findUsers, variables: {emails: ['x' + ourEmail]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([]))

  // Find one user
  // Test with Query
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([other1]))
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, 'AA' + other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([us]))
  // Test with Mutation
  await ourClient
    .mutate({mutations: mutations.findUsers, variables: {emails: [other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([other1]))
  await ourClient
    .mutate({mutations: mutations.findUsers, variables: {emails: [ourEmail, 'AA' + other1Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([us]))

  // Find multiple users
  // Test with Query
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, other1Email, other2Email]}})
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, other1, other2].sort(cmp)))
  // Test with Mutation
  await ourClient
    .mutate({mutations: mutations.findUsers, variables: {emails: [ourEmail, other1Email, other2Email]}})
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

  // Find them by just phone
  await misc.sleep(2000)
  // Test with Query
  await ourClient
    .query({query: queries.findUsers, variables: {phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([them]))
  // Test with Mutation
  await ourClient
    .mutate({mutations: mutations.findUsers, variables: {phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items).toEqual([them]))

  // Find us and them by phone and email, make sure they don't duplicate
  // Test with Query
  await ourClient
    .query({query: queries.findUsers, variables: {emails: [ourEmail, theirEmail], phoneNumbers: [theirPhone]}})
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, them].sort(cmp)))
  // Test with Mutation
  await ourClient
    .mutate({
      mutations: mutations.findUsers,
      variables: {emails: [ourEmail, theirEmail], phoneNumbers: [theirPhone]},
    })
    .then(({data: {findUsers}}) => expect(findUsers.items.sort(cmp)).toEqual([us, them].sort(cmp)))
})
