/** @format */

export function formatDistanceToNow(date, { addSuffix = false } = {}) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  let result;

  if (seconds < 60) {
    result = 'less than a minute';
  } else {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      result = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        result = `about ${hours} hour${hours !== 1 ? 's' : ''}`;
      } else {
        const days = Math.floor(hours / 24);
        if (days < 30) {
          result = `${days} day${days !== 1 ? 's' : ''}`;
        } else {
          const months = Math.floor(days / 30);
          if (months < 12) {
            result = `about ${months} month${months !== 1 ? 's' : ''}`;
          } else {
            const years = Math.floor(months / 12);
            result = `about ${years} year${years !== 1 ? 's' : ''}`;
          }
        }
      }
    }
  }

  return addSuffix ? `${result} ago` : result;
}
