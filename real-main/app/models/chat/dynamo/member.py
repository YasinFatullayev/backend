import logging

from boto3.dynamodb.conditions import Key
import pendulum

logger = logging.getLogger()


class ChatMemberDynamo:

    def __init__(self, dynamo_client):
        self.client = dynamo_client

    def pk(self, chat_id, user_id):
        return {
            'partitionKey': f'chat/{chat_id}',
            'sortKey': f'member/{user_id}',
        }

    def typed_pk(self, chat_id, user_id):
        return {
            'partitionKey': {'S': f'chat/{chat_id}'},
            'sortKey': {'S': f'member/{user_id}'},
        }

    def get(self, chat_id, user_id, strongly_consistent=False):
        return self.client.get_item(self.pk(chat_id, user_id), ConsistentRead=strongly_consistent)

    def transact_add(self, chat_id, user_id, now=None):
        now = now or pendulum.now('utc')
        joined_at_str = now.to_iso8601_string()
        return {'Put': {
            'Item': {
                'schemaVersion': {'N': '0'},
                'partitionKey': {'S': f'chat/{chat_id}'},
                'sortKey': {'S': f'member/{user_id}'},
                'gsiK1PartitionKey': {'S': f'chat/{chat_id}'},
                'gsiK1SortKey': {'S': f'member/{joined_at_str}'},
                'gsiK2PartitionKey': {'S': f'member/{user_id}'},
                'gsiK2SortKey': {'S': f'chat/{joined_at_str}'},  # actually tracks lastMessageActivityAt
            },
            'ConditionExpression': 'attribute_not_exists(partitionKey)',  # no updates, just adds
        }}

    def transact_delete(self, chat_id, user_id):
        return {'Delete': {
            'Key': self.typed_pk(chat_id, user_id),
            'ConditionExpression': 'attribute_exists(partitionKey)',
        }}

    def update_all_last_message_activity_at(self, chat_id, now):
        # Note that dynamo has no support for batch updates.
        # This update will need to be made async at some scale (chats with 1000+ members?)
        for user_id in self.generate_user_ids_by_chat(chat_id):
            self.update_last_message_activity_at(chat_id, user_id, now)

    def update_last_message_activity_at(self, chat_id, user_id, now):
        query_kwargs = {
            'Key': self.pk(chat_id, user_id),
            'UpdateExpression': 'SET gsiK2SortKey = :gsik2sk',
            'ExpressionAttributeValues': {
                ':gsik2sk': 'chat/' + now.to_iso8601_string(),
            },
        }
        return self.client.update_item(query_kwargs)

    def generate_user_ids_by_chat(self, chat_id):
        query_kwargs = {
            'KeyConditionExpression': (
                Key('gsiK1PartitionKey').eq(f'chat/{chat_id}')
                & Key('gsiK1SortKey').begins_with('member/')
            ),
            'IndexName': 'GSI-K1',
        }
        return map(
            lambda item: item['sortKey'][len('member/'):],
            self.client.generate_all_query(query_kwargs),
        )

    def generate_chat_ids_by_user(self, user_id):
        query_kwargs = {
            'KeyConditionExpression': (
                Key('gsiK2PartitionKey').eq(f'member/{user_id}')
                & Key('gsiK2SortKey').begins_with('chat/')
            ),
            'IndexName': 'GSI-K2',
        }
        return map(
            lambda item: item['partitionKey'][len('chat/'):],
            self.client.generate_all_query(query_kwargs),
        )