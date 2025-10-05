export const secondsFromNowIso = (sec: number) =>
  new Date(Date.now() + sec * 1000).toISOString();
