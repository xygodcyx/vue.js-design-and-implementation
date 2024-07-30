// 'use strict'

const obj = {
  a: 1,
}

Object.defineProperty(obj, 'b', {
  value: 3,
  enumerable: true,
  writable: false,
})

Object.defineProperty(obj, 'c', {
  value: 4,
  enumerable: true,
  writable: true,
  configurable: false,
})
console.log(
  Object.setPrototypeOf(obj, {
    a: 1,
    b: 3,
    c: 2,
    d: 4,
  })
)
console.log(Object.getPrototypeOf(obj))
console.log(Object.keys(obj))
console.log(delete obj.c)
console.log(Object.getOwnPropertyNames(obj))
// console.log(Object.preventExtensions(obj)) //使对象不可扩展
console.log(Object.isExtensible(obj)) //判断对象是否可扩展
console.log(Object.getOwnPropertyDescriptors(obj)) //获取属性描述符

obj.c = 4
console.log(obj)
