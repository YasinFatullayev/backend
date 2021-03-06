import logging
from unittest.mock import call, patch
from uuid import uuid4

import pytest

from app.models.post.enums import PostStatus, PostType


@pytest.fixture
def user(user_manager, cognito_client):
    user_id, username = str(uuid4()), str(uuid4())[:8]
    cognito_client.create_verified_user_pool_entry(user_id, username, f'{username}@real.app')
    yield user_manager.create_cognito_only_user(user_id, username)


@pytest.fixture
def comment(user, post_manager, comment_manager):
    post = post_manager.add_post(user, str(uuid4()), PostType.TEXT_ONLY, text='go go')
    yield comment_manager.add_comment(str(uuid4()), post.id, user.id, 'run far')


@pytest.fixture
def card(user, card_manager, TestCardTemplate):
    yield card_manager.add_or_update_card(TestCardTemplate(user.id, title='card title', action='https://action/'))


@pytest.fixture
def chat(user, chat_manager):
    yield chat_manager.add_group_chat(str(uuid4()), user)


@pytest.fixture
def album(album_manager, user):
    yield album_manager.add_album(user.id, str(uuid4()), 'album name')


def test_on_comment_add_adjusts_counts(user_manager, user, comment):
    # check & save starting state
    org_item = user.refresh_item().item
    assert 'commentCount' not in org_item

    # process, check state
    user_manager.on_comment_add(comment.id, comment.item)
    assert user.refresh_item().item['commentCount'] == 1

    # process, check state
    user_manager.on_comment_add(comment.id, comment.item)
    assert user.refresh_item().item['commentCount'] == 2

    # check for unexpected state changes
    new_item = user.item
    new_item.pop('commentCount')
    assert new_item == org_item


def test_on_comment_delete_adjusts_counts(user_manager, user, comment, caplog):
    # configure, check & save starting state
    user_manager.on_comment_add(comment.id, comment.item)
    org_item = user.refresh_item().item
    assert org_item['commentCount'] == 1
    assert 'commentDeletedCount' not in org_item

    # process, check state
    user_manager.on_comment_delete(comment.id, comment.item)
    new_item = user.refresh_item().item
    assert new_item['commentCount'] == 0
    assert new_item['commentDeletedCount'] == 1

    # process again, verify fails softly
    with caplog.at_level(logging.WARNING):
        user_manager.on_comment_delete(comment.id, comment.item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert 'commentCount' in caplog.records[0].msg
    assert user.id in caplog.records[0].msg
    new_item = user.refresh_item().item
    assert new_item['commentCount'] == 0
    assert new_item['commentDeletedCount'] == 2

    # check for unexpected state changes
    del new_item['commentCount'], org_item['commentCount'], new_item['commentDeletedCount']
    assert new_item == org_item


def test_on_user_delete_calls_elasticsearch(user_manager, user):
    with patch.object(user_manager, 'elasticsearch_client') as elasticsearch_client_mock:
        user_manager.on_user_delete(user.id, user.item)
    assert elasticsearch_client_mock.mock_calls == [call.delete_user(user.id)]


def test_on_user_delete_calls_pinpoint(user_manager, user):
    with patch.object(user_manager, 'pinpoint_client') as pinpoint_client_mock:
        user_manager.on_user_delete(user.id, user.item)
    assert pinpoint_client_mock.mock_calls == [call.delete_user_endpoints(user.id)]


def test_on_card_add_increment_count(user_manager, user, card):
    assert user.refresh_item().item.get('cardCount', 0) == 0

    # handle add, verify state
    user_manager.on_card_add_increment_count(card.id, card.item)
    assert user.refresh_item().item.get('cardCount', 0) == 1

    # handle add, verify state
    user_manager.on_card_add_increment_count(card.id, card.item)
    assert user.refresh_item().item.get('cardCount', 0) == 2


def test_on_card_delete_decrement_count(user_manager, user, card, caplog):
    user_manager.dynamo.increment_card_count(user.id)
    assert user.refresh_item().item.get('cardCount', 0) == 1

    # handle delete, verify state
    user_manager.on_card_delete_decrement_count(card.id, card.item)
    assert user.refresh_item().item.get('cardCount', 0) == 0

    # handle delete, verify fails softly and state unchanged
    with caplog.at_level(logging.WARNING):
        user_manager.on_card_delete_decrement_count(card.id, card.item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert 'cardCount' in caplog.records[0].msg
    assert user.id in caplog.records[0].msg
    assert user.refresh_item().item.get('cardCount', 0) == 0


def test_on_chat_member_add_update_chat_count(user_manager, chat, user):
    # check starting state
    member_item = chat.member_dynamo.get(chat.id, user.id)
    assert member_item
    assert user.refresh_item().item.get('chatCount', 0) == 0

    # react to an add, check state
    user_manager.on_chat_member_add_update_chat_count(chat.id, new_item=member_item)
    assert user.refresh_item().item.get('chatCount', 0) == 1

    # react to another add, check state
    user_manager.on_chat_member_add_update_chat_count(chat.id, new_item=member_item)
    assert user.refresh_item().item.get('chatCount', 0) == 2


def test_on_chat_member_delete_update_chat_count(user_manager, chat, user, caplog):
    # configure and check starting state
    member_item = chat.member_dynamo.get(chat.id, user.id)
    assert member_item
    user_manager.dynamo.increment_chat_count(user.id)
    assert user.refresh_item().item.get('chatCount', 0) == 1

    # react to an delete, check state
    user_manager.on_chat_member_delete_update_chat_count(chat.id, old_item=member_item)
    assert user.refresh_item().item.get('chatCount', 0) == 0

    # react to another delete, verify fails softly
    with caplog.at_level(logging.WARNING):
        user_manager.on_chat_member_delete_update_chat_count(chat.id, old_item=member_item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert 'chatCount' in caplog.records[0].msg
    assert user.id in caplog.records[0].msg
    assert user.refresh_item().item.get('chatCount', 0) == 0


def test_on_album_add_update_album_count(user_manager, album, user):
    # check starting state
    assert user.refresh_item().item.get('albumCount', 0) == 0

    # react to an add, check state
    user_manager.on_album_add_update_album_count(album.id, new_item=album.item)
    assert user.refresh_item().item.get('albumCount', 0) == 1

    # react to another add, check state
    user_manager.on_album_add_update_album_count(album.id, new_item=album.item)
    assert user.refresh_item().item.get('albumCount', 0) == 2


def test_on_album_delete_update_album_count(user_manager, album, user, caplog):
    # configure and check starting state
    user_manager.dynamo.increment_album_count(user.id)
    assert user.refresh_item().item.get('albumCount', 0) == 1

    # react to an delete, check state
    user_manager.on_album_delete_update_album_count(album.id, old_item=album.item)
    assert user.refresh_item().item.get('albumCount', 0) == 0

    # react to another delete, verify fails softly
    with caplog.at_level(logging.WARNING):
        user_manager.on_album_delete_update_album_count(album.id, old_item=album.item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert 'albumCount' in caplog.records[0].msg
    assert user.id in caplog.records[0].msg
    assert user.refresh_item().item.get('albumCount', 0) == 0


@pytest.mark.parametrize(
    'new_status, count_col_incremented',
    [
        [PostStatus.COMPLETED, 'postCount'],
        [PostStatus.ARCHIVED, 'postArchivedCount'],
        [PostStatus.DELETING, 'postDeletedCount'],
    ],
)
def test_on_post_status_change_sync_counts_new_status(
    user_manager, user, new_status, count_col_incremented,
):
    post_id = str(uuid4())
    new_item = {'postId': post_id, 'postedByUserId': user.id, 'postStatus': new_status}
    old_item = {'postId': post_id, 'postedByUserId': user.id, 'postStatus': 'whateves'}
    count_cols = ['postCount', 'postArchivedCount', 'postDeletedCount']

    # check starting state
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == 0

    # react to the change, check counts
    user_manager.on_post_status_change_sync_counts(post_id, new_item=new_item, old_item=old_item)
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == (1 if col == count_col_incremented else 0)

    # react to the change again, check counts
    user_manager.on_post_status_change_sync_counts(post_id, new_item=new_item, old_item=old_item)
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == (2 if col == count_col_incremented else 0)


@pytest.mark.parametrize(
    'old_status, count_col_decremented',
    [[PostStatus.COMPLETED, 'postCount'], [PostStatus.ARCHIVED, 'postArchivedCount']],
)
def test_on_post_status_change_sync_counts_old_status(
    user_manager, user, old_status, count_col_decremented, caplog,
):
    post_id = str(uuid4())
    new_item = {'postId': post_id, 'postedByUserId': user.id, 'postStatus': 'whateves'}
    old_item = {'postId': post_id, 'postedByUserId': user.id, 'postStatus': old_status}
    count_cols = ['postCount', 'postArchivedCount', 'postDeletedCount']

    # configure and check starting state
    user.dynamo.increment_post_count(user.id)
    user.dynamo.increment_post_archived_count(user.id)
    user.dynamo.increment_post_deleted_count(user.id)
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == 1

    # react to the change, check counts
    user_manager.on_post_status_change_sync_counts(post_id, new_item=new_item, old_item=old_item)
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == (0 if col == count_col_decremented else 1)

    # react to the change again, verify fails softly
    with caplog.at_level(logging.WARNING):
        user_manager.on_post_status_change_sync_counts(post_id, new_item=new_item, old_item=old_item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert count_col_decremented in caplog.records[0].msg
    assert user.id in caplog.records[0].msg
    user.refresh_item()
    for col in count_cols:
        assert user.item.get(col, 0) == (0 if col == count_col_decremented else 1)


@pytest.mark.parametrize(
    'method_name, attr_name, dynamo_lib_name',
    [
        ['on_user_email_change_update_subitem', 'email', 'email_dynamo'],
        ['on_user_phone_number_change_update_subitem', 'phoneNumber', 'phone_number_dynamo'],
    ],
)
def test_on_user_contact_attribute_change_update_subitem(
    user_manager, user, method_name, attr_name, dynamo_lib_name
):
    # test adding for the first time
    new_item = {**user.item, attr_name: 'the-value'}
    with patch.object(user_manager, dynamo_lib_name) as dynamo_lib_mock:
        getattr(user_manager, method_name)(user.id, new_item=new_item)
    assert dynamo_lib_mock.mock_calls == [call.add('the-value', user.id)]

    # test changing to a different value
    old_item = new_item.copy()
    new_item = {**old_item, attr_name: 'new-value'}
    with patch.object(user_manager, dynamo_lib_name) as dynamo_lib_mock:
        getattr(user_manager, method_name)(user.id, new_item=new_item, old_item=old_item)
    assert dynamo_lib_mock.mock_calls == [call.add('new-value', user.id), call.delete('the-value', user.id)]

    # test deleting the value
    old_item = new_item.copy()
    with patch.object(user_manager, dynamo_lib_name) as dynamo_lib_mock:
        getattr(user_manager, method_name)(user.id, old_item=old_item)
    assert dynamo_lib_mock.mock_calls == [call.delete('new-value', user.id)]
