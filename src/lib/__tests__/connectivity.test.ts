import {
  OperationTimeoutError,
  isConnectionFailure,
  isMissingClerkAccount,
  withTimeout,
} from '../connectivity';

describe('connectivity helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('bounds SDK calls that do not accept an AbortSignal', async () => {
    jest.useFakeTimers();
    const pending = new Promise<string>(() => {});
    const result = withTimeout(pending, 1_000, 'verify code');

    jest.advanceTimersByTime(1_000);

    await expect(result).rejects.toEqual(new OperationTimeoutError('verify code'));
  });

  it('does not turn a transport failure into account creation', () => {
    expect(isMissingClerkAccount({ code: 'network_error' })).toBe(false);
    expect(
      isMissingClerkAccount({ errors: [{ code: 'form_identifier_not_found' }] }),
    ).toBe(true);
  });

  it('recognizes Clerk, API, and deadline transport failures', () => {
    expect(isConnectionFailure({ code: 'network_error' })).toBe(true);
    expect(isConnectionFailure({ name: 'ApiTimeoutError' })).toBe(true);
    expect(isConnectionFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isConnectionFailure({ errors: [{ code: 'form_code_incorrect' }] })).toBe(false);
  });
});
