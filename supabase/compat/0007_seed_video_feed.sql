-- 0007_seed_video_feed.sql
-- Сид вертикальной видео-ленты (TikTok-style, /api/video-feed).
-- Демо-видео (тестовые HLS-стримы Mux) привязаны к реальным демо-кондитерам c0/c1/c2.
-- Идемпотентен: ON CONFLICT (id) DO NOTHING.

INSERT INTO "video_feed_items" (
    "id", "confectionerId", "videoUrl", "posterUrl", "title", "description",
    "viewsCount", "likesCount", "commentsCount", "sharesCount",
    "productId", "audioTitle", "status", "rating", "createdAt"
) VALUES
    (
        'v1', 'c0',
        'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        'https://images.unsplash.com/photo-1535254973040-607b474cb50d?w=400',
        'Создаю свадебный торт с сахарными цветами 🌸',
        '3-ярусный торт с ручной росписью. 12 часов работы в 60 секунд!',
        1247, 342, 28, 15,
        NULL, 'Оригинальный звук', 'active', 50, now() - interval '3 days'
    ),
    (
        'v2', 'c1',
        'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400',
        'Шоколадный торт с зеркальной глазурью ✨',
        'Зеркальная глазурь — это магия. Смотрите как получается идеальная поверхность!',
        892, 256, 19, 8,
        'aaaaaaaa-0000-4000-8000-000000000002', 'Оригинальный звук', 'active', 50, now() - interval '2 days'
    ),
    (
        'v3', 'c2',
        'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400',
        'Бенто-торт за 5 минут ⏱️',
        'Мини-торт для одного — быстро, красиво, вкусно!',
        2156, 587, 42, 31,
        NULL, 'Trending Audio', 'active', 50, now() - interval '1 day'
    )
ON CONFLICT ("id") DO NOTHING;
