/* eslint-env jest */

const uuidv4 = require('uuid/v4')

const cognito = require('../../utils/cognito.js')
const misc = require('../../utils/misc.js')
const schema = require('../../utils/schema.js')

const imageData = misc.generateRandomJpeg(8, 8)
const imageDataB64 = new Buffer.from(imageData).toString('base64')

const loginCache = new cognito.AppSyncLoginCache()

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.clean())


test('One user adds multiple comments, ordering', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()

  // we add a post
  const postId = uuidv4()
  let variables = {postId, mediaId: uuidv4(), imageData: imageDataB64}
  let resp = await ourClient.mutate({mutation: schema.addPost, variables})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addPost']['postId']).toBe(postId)
  expect(resp['data']['addPost']['commentCount']).toBe(0)
  expect(resp['data']['addPost']['comments']['items']).toHaveLength(0)

  // we add a comment on the post
  const commentId1 = uuidv4()
  variables = {commentId: commentId1, postId, text: 'lore'}
  resp = await ourClient.mutate({mutation: schema.addComment, variables})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addComment']['commentId']).toBe(commentId1)

  // we add another comment on the post
  const commentId2 = uuidv4()
  variables = {commentId: commentId2, postId, text: 'ipsum'}
  resp = await ourClient.mutate({mutation: schema.addComment, variables})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['addComment']['commentId']).toBe(commentId2)

  // check we see both comments, in order, on the post
  resp = await ourClient.query({query: schema.post, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  const post = resp['data']['post']
  expect(post['postId']).toBe(postId)
  expect(post['commentCount']).toBe(2)
  expect(post['comments']['items']).toHaveLength(2)
  expect(post['comments']['items'][0]['commentId']).toBe(commentId1)
  expect(post['comments']['items'][0]['commentedBy']['userId']).toBe(ourUserId)
  expect(post['comments']['items'][1]['commentId']).toBe(commentId2)
  expect(post['comments']['items'][1]['commentedBy']['userId']).toBe(ourUserId)

  // verify we can supply the default value of reverse and get the same thing
  resp = await ourClient.query({query: schema.post, variables: {postId, commentsReverse: false}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['comments']).toEqual(post['comments'])

  // check we can reverse the order of those comments
  resp = await ourClient.query({query: schema.post, variables: {postId, commentsReverse: true}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['post']['postId']).toBe(postId)
  expect(resp['data']['post']['commentCount']).toBe(2)
  expect(resp['data']['post']['comments']['items']).toHaveLength(2)
  expect(resp['data']['post']['comments']['items'][0]['commentId']).toBe(commentId2)
  expect(resp['data']['post']['comments']['items'][0]['commentedBy']['userId']).toBe(ourUserId)
  expect(resp['data']['post']['comments']['items'][1]['commentId']).toBe(commentId1)
  expect(resp['data']['post']['comments']['items'][1]['commentedBy']['userId']).toBe(ourUserId)
})
