export function formatPhoneNumber(phone) {
  if (!phone) {
    return null;
  }
  const cleaned = phone.replace(/[\s()\-]/g, '');
  return `+1${cleaned}`;
}