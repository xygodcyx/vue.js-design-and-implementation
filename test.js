function normalizeStyle(value) {
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('style must be an object')
  }
  const res = {}
}

const style = {
  color: 'red',
  transform: 'translateX(10px)',
}
