from io import BytesIO
import logging
from os import path

from PIL import Image
import pytest

from app.models.media.enums import MediaSize

grant_rotated_width = grant_height = 320
grant_rotated_height = grant_width = 240
grant_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'grant.jpg')
grant_rotated_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'grant-rotated.jpg')
blank_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'big-blank.jpg')
squirrel_path = path.join(path.dirname(__file__), '..', '..', 'fixtures', 'squirrel.png')

grant_colors = [
    {'r': 52, 'g': 58, 'b': 46},
    {'r': 186, 'g': 206, 'b': 228},
    {'r': 144, 'g': 154, 'b': 170},
    {'r': 158, 'g': 180, 'b': 205},
    {'r': 131, 'g': 125, 'b': 125},
]


@pytest.fixture
def media_awaiting_upload(media_manager, post_manager):
    media_uploads = [{'mediaId': 'mid', 'mediaType': media_manager.enums.MediaType.IMAGE}]
    post = post_manager.add_post('uid', 'pid', media_uploads=media_uploads)
    media_item = post.item['mediaObjects'][0]
    yield media_manager.init_media(media_item)


def test_set_height_and_width(dynamo_client, s3_client, media_awaiting_upload):
    media = media_awaiting_upload
    assert 'height' not in media.item
    assert 'width' not in media.item

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(grant_path, 'rb'), 'image/jpeg')

    media.set_height_and_width()
    assert media.item['height'] == grant_height
    assert media.item['width'] == grant_width


def test_set_colors(dynamo_client, s3_client, media_awaiting_upload):
    media = media_awaiting_upload
    assert 'colors' not in media.item

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(grant_path, 'rb'), 'image/jpeg')

    media.set_colors()
    assert media.item['colors'] == grant_colors


def test_set_colors_colortheif_fails(dynamo_client, s3_client, media_awaiting_upload, caplog):
    media = media_awaiting_upload
    assert 'colors' not in media.item

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(blank_path, 'rb'), 'image/jpeg')

    assert len(caplog.records) == 0
    with caplog.at_level(logging.WARNING):
        media.set_colors()
        assert 'colors' not in media.item

    assert len(caplog.records) == 1
    assert caplog.records[0].levelname == 'WARNING'
    assert 'ColorTheif' in caplog.records[0].msg
    assert f'`{media.id}`' in caplog.records[0].msg


def test_set_thumbnails_wide_image(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(blank_path, 'rb'), 'image/jpeg')

    media.set_thumbnails()

    # check the 4k thumbnail is there, and that it is the right size
    path_4k = media.get_s3_path(MediaSize.K4)
    assert s3_client.exists(path_4k)
    image = Image.open(s3_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width == 3840
    assert height < 2160

    # check the 1080 thumbnail is there, and that it is the right size
    path_1080 = media.get_s3_path(MediaSize.P1080)
    assert s3_client.exists(path_1080)
    image = Image.open(s3_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width == 1920
    assert height < 1080

    # check the 480 thumbnail is there, and that it is the right size
    path_480 = media.get_s3_path(MediaSize.P480)
    assert s3_client.exists(path_480)
    image = Image.open(s3_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width == 854
    assert height < 480

    # check the 64 thumbnail is there, and that it is the right size
    path_64 = media.get_s3_path(MediaSize.P64)
    assert s3_client.exists(path_64)
    image = Image.open(s3_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width == 114
    assert height < 64


def test_set_thumbnails_tall_image(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # rotate our wide image to make it tall
    image = Image.open(blank_path).rotate(90, expand=True)
    in_mem_file = BytesIO()
    image.save(in_mem_file, format='JPEG')
    in_mem_file.seek(0)

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, in_mem_file, 'image/jpeg')

    media.set_thumbnails()

    # check the 4k thumbnail is there, and that it is the right size
    path_4k = media.get_s3_path(MediaSize.K4)
    assert s3_client.exists(path_4k)
    image = Image.open(s3_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width < 3840
    assert height == 2160

    # check the 1080 thumbnail is there, and that it is the right size
    path_1080 = media.get_s3_path(MediaSize.P1080)
    assert s3_client.exists(path_1080)
    image = Image.open(s3_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width < 1920
    assert height == 1080

    # check the 480 thumbnail is there, and that it is the right size
    path_480 = media.get_s3_path(MediaSize.P480)
    assert s3_client.exists(path_480)
    image = Image.open(s3_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width < 854
    assert height == 480

    # check the 64 thumbnail is there, and that it is the right size
    path_64 = media.get_s3_path(MediaSize.P64)
    assert s3_client.exists(path_64)
    image = Image.open(s3_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width < 114
    assert height == 64


def test_set_thumbnails_respect_exif_orientation(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(grant_rotated_path, 'rb'), 'image/jpeg')

    media.set_thumbnails()

    # check that the thumbnailing process respected the exif orientation tag,
    # by looking at width and height of output image

    # check 4k
    path_4k = media.get_s3_path(MediaSize.K4)
    assert s3_client.exists(path_4k)
    image = Image.open(s3_client.get_object_data_stream(path_4k))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 1080p
    path_1080 = media.get_s3_path(MediaSize.P1080)
    assert s3_client.exists(path_1080)
    image = Image.open(s3_client.get_object_data_stream(path_1080))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 480p
    path_480 = media.get_s3_path(MediaSize.P480)
    assert s3_client.exists(path_480)
    image = Image.open(s3_client.get_object_data_stream(path_480))
    width, height = image.size
    assert width == grant_rotated_width
    assert height == grant_rotated_height

    # check 64p
    path_64 = media.get_s3_path(MediaSize.P64)
    assert s3_client.exists(path_64)
    image = Image.open(s3_client.get_object_data_stream(path_64))
    width, height = image.size
    assert width < grant_rotated_width
    assert height < grant_rotated_height
    assert width < 114
    assert height == 64


def test_set_thumbnails_content_type(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put an image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(blank_path, 'rb'), 'image/jpeg')

    media.set_thumbnails()

    # check the height and width of the thumbnails to make sure the
    # thumbnailing process correctly accounted for the exif orientation header

    # check 4k content type
    path_4k = media.get_s3_path(MediaSize.K4)
    assert s3_client.bucket.Object(path_4k).content_type == 'image/jpeg'

    # check 1080p content type
    path_1080 = media.get_s3_path(MediaSize.P1080)
    assert s3_client.bucket.Object(path_1080).content_type == 'image/jpeg'

    # check 480p content type
    path_480 = media.get_s3_path(MediaSize.P480)
    assert s3_client.bucket.Object(path_480).content_type == 'image/jpeg'

    # check 64p content type
    path_64 = media.get_s3_path(MediaSize.P64)
    assert s3_client.bucket.Object(path_64).content_type == 'image/jpeg'


def test_is_original_jpeg_success(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put a jpeg image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(grant_path, 'rb'), 'image/jpeg')

    assert media.is_original_jpeg()


def test_is_original_jpeg_failure(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put a png image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, open(squirrel_path, 'rb'), 'image/png')

    assert not media.is_original_jpeg()


def test_is_original_jpeg_failure_with_exception(s3_client, media_awaiting_upload):
    media = media_awaiting_upload

    # put a png image in the bucket
    media_path = media.get_s3_path(MediaSize.NATIVE)
    s3_client.put_object(media_path, b'not an image', 'application/octet-stream')

    assert not media.is_original_jpeg()
