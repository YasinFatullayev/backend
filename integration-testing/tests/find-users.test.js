const cognito = require('../utils/cognito')
const misc = require('../utils/misc')
const {mutations} = require('../schema')

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
  await expect(client.mutate({mutation: mutations.findUsers, variables: {emails}})).rejects.toThrow(
    /Cannot submit more than 100 combined emails and phoneNumbers/,
  )
})

test('Find users can handle duplicate emails', async () => {
  const {client, userId, email, username} = await loginCache.getCleanLogin()
  await misc.sleep(2000)
  let resp = await client.mutate({
    mutations: mutations.findUsers,
    variables: {emails: [email, email]},
  })

  expect(resp.data.items).toHaveLength(1)
  expect(resp.data.items[0].userId).toBe(userId)
  expect(resp.data.items[0].username).toBe(username)
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

  // how each user will appear in search results, based on our query
  const us = {__typename: 'User', userId: ourUserId, username: ourUsername}
  const other1 = {__typename: 'User', userId: other1UserId, username: other1Username}
  const other2 = {__typename: 'User', userId: other2UserId, username: other2Username}

  // find no users
  await misc.sleep(2000)
  let resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {emails: ['x' + ourEmail]},
  })
  expect(resp.data.items).toEqual([])

  resp = await ourClient.mutate({
    mutations: mutations.findUsers,
  })
  expect(resp.data.items).toEqual([])
  expect(resp.data.nextToken).toBe(null)

  // find one user
  resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {emails: [other1Email]},
  })
  expect(resp.data.items).toEqual([other1])

  resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {emails: [ourEmail, 'AA' + other1Email]},
  })
  expect(resp.data.items).toEqual([us])

  // find multiple users
  resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {emails: [ourEmail, other1Email, other2Email]},
  })
  expect(resp.data.items).toEqual([us, other1, other2])
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
  let resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {phoneNumbers: [theirPhone]},
  })
  expect(resp.data.items).toEqual([them])

  // find us and them by phone and email, make sure they don't duplicate
  resp = await ourClient.mutate({
    mutations: mutations.findUsers,
    variables: {emails: [ourEmail, theirEmail], phoneNumbers: [theirPhone]},
  })
  expect(resp.data.items).toEqual([us, them].sort(cmp))
})
