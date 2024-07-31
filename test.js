function normalizeStyle(value) {
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('style must be an object')
  }
  let res = ''
  function camelToKebab(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
  }
  function camelStyleToKebab(value) {
    const res = {}
    // 检查是否有浏览器支持的样式属性
    const dom = document.createElement('div')
    for (const key in value) {
      if (key in dom.style) {
        res[camelToKebab(key)] = value[key]
      } else {
        console.warn(`Invalid style property: ${key}`)
      }
    }
    return res
  }

  let styleObj = {}
  styleObj = camelStyleToKebab(value)
  function transformStyleToString(res) {
    let styleStr = ''
    for (const key in res) {
      styleStr += `${key}:${res[key]};`
    }
    return styleStr
  }
  res = transformStyleToString(styleObj)

  return res
}

const style = {
  color: 'red',
  transform: 'translateX(10px)',
  width: '100px',
  height: '100px',
  borderRadius: '5px',
}
