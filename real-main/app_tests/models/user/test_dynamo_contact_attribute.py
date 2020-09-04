from uuid import uuid4

import pytest

from app.models.user.dynamo import UserContactAttributeDynamo


@pytest.fixture
def uca_dynamo(dynamo_client):
    yield UserContactAttributeDynamo(dynamo_client, 'somePrefix')


def test_basic_add_get_delete(uca_dynamo):
    # check starting state
    attr_value = 'the-value'
    assert uca_dynamo.get(attr_value) is None

    # add it, verify format
    user_id = str(uuid4())
    item = uca_dynamo.add(attr_value, user_id)
    assert uca_dynamo.get(attr_value) == item
    assert item == {
        'partitionKey': f'somePrefix/{attr_value}',
        'sortKey': '-',
        'schemaVersion': 0,
        'userId': user_id,
    }
    assert uca_dynamo.get(attr_value + 'nope') is None

    # check we can't re-add it for another user
    user_id_2 = str(uuid4())
    with pytest.raises(uca_dynamo.client.exceptions.ConditionalCheckFailedException):
        uca_dynamo.add(attr_value, user_id_2)
    assert uca_dynamo.get(attr_value) == item

    # check that user can take their own different value
    attr_value_2 = 'other-value'
    item_2 = uca_dynamo.add(attr_value_2, user_id_2)
    assert uca_dynamo.get(attr_value_2) == item_2
    assert uca_dynamo.get(attr_value) == item

    # delete a value, make sure it goes away
    assert uca_dynamo.delete(attr_value, user_id) == item
    assert uca_dynamo.get(attr_value) is None

    # check deletes are omnipotent
    assert uca_dynamo.delete(attr_value, user_id) is None
    assert uca_dynamo.get(attr_value) is None

    # verify can't delete a value if we supply the wrong user_id
    with pytest.raises(uca_dynamo.client.exceptions.ConditionalCheckFailedException):
        uca_dynamo.delete(attr_value_2, user_id)
    assert uca_dynamo.get(attr_value_2) == item_2


def test_get_bach_items_with_email(uca_dynamo):
    # add 2 user emails
    userId1 = str(uuid4())
    userEmail1 = f'{userId1}@real.app'

    # check starting Email state
    attr_value1 = userEmail1
    assert uca_dynamo.get(attr_value1) is None

    # Add first item
    item1 = uca_dynamo.add(attr_value1, userId1)
    assert uca_dynamo.get(attr_value1) == item1

    userId2 = str(uuid4())
    userEmail2 = f'{userId2}@real.app'

    # check starting Email state
    attr_value2 = userEmail2
    assert uca_dynamo.get(attr_value2) is None

    # Add second item
    item2 = uca_dynamo.add(attr_value2, userId2)
    assert uca_dynamo.get(attr_value2) == item2

    # Check Keys
    # batchEmailKeys = []
    # batchEmailItems = uca_dynamo.getBatchItems(batchEmailKeys)
    # assert uca_dynamo.getBatchItems(batchEmailKeys) is None

    batchEmailKeys = [attr_value1, attr_value2]
    batchEmailItems = uca_dynamo.getBatchItems(batchEmailKeys)
    assert uca_dynamo.getBatchItems(batchEmailKeys) == batchEmailItems


def test_get_bach_items_with_phone(uca_dynamo):
    # add 2 user phones
    userId1 = str(uuid4())
    userPhone1 = '+1234-567-8900'

    # check starting Phone state
    attr_value1 = userPhone1
    assert uca_dynamo.get(attr_value1) is None

    # Add first item
    item1 = uca_dynamo.add(attr_value1, userId1)
    assert uca_dynamo.get(attr_value1) == item1

    userId2 = str(uuid4())
    userPhone2 = '+1234-567-8901'

    # check starting Phone state
    attr_value2 = userPhone2
    assert uca_dynamo.get(attr_value2) is None

    # Add second item
    item2 = uca_dynamo.add(attr_value2, userId2)
    assert uca_dynamo.get(attr_value2) == item2

    # Check Keys
    # batchPhoneKeys = []
    # batchPhoneItems = uca_dynamo.getBatchItems(batchPhoneKeys)
    # assert uca_dynamo.getBatchItems(batchPhoneKeys) is None

    batchPhoneKeys = [attr_value1, attr_value2]
    batchPhoneItems = uca_dynamo.getBatchItems(batchPhoneKeys)
    assert uca_dynamo.getBatchItems(batchPhoneKeys) == batchPhoneItems
