import { APP_ORIGIN, CLERK_PROXY_URL, PRIMARY_API_BASE, routeStorageUrls } from '../edge';

describe('application endpoints', () => {
  it('uses one hostname for API and Clerk', () => {
    expect(PRIMARY_API_BASE).toBe(`${APP_ORIGIN}/api`);
    expect(CLERK_PROXY_URL).toBe(`${APP_ORIGIN}/__clerk`);
  });

  it('routes nested signed media fields while preserving the signature and unrelated URLs', () => {
    const signed = 'https://account.r2.cloudflarestorage.com/bucket/a%20b.mp4?X-Amz-Signature=abc&x=one%2Ftwo';
    const input = { trials: [{ video_url: signed, image_url: signed }], upload_url: signed, empty: null };
    const result = routeStorageUrls(input);
    const expected = 'https://luche.ai/r2/bucket/a%20b.mp4?X-Amz-Signature=abc&x=one%2Ftwo';
    expect(result.trials[0].video_url).toBe(expected);
    expect(result.upload_url).toBe(expected);
    expect(result.trials[0].image_url).toBe(signed);
    expect(input.upload_url).toBe(signed);
    expect(result.empty).toBeNull();
  });

  it('keeps already-routed, unrelated and malformed URLs unchanged', () => {
    for (const url of ['https://luche.ai/r2/bucket/a?signature=abc', 'https://example.com/a', 'invalid']) {
      expect(routeStorageUrls({ video_url: url })).toEqual({ video_url: url });
    }
  });
});
