# 一些因框架导致的问题以及处理

<p style="display: flex; justify-content: start; gap: 10px;">
  <a href="../README.md">首页</a>
  <a href="../renderer/README.md">上一页</a>
</p>

## 数据污染

  做所谓的数据污染指的是将响应式数据赋值给了原始数据(响应式数据就是经过我们一系列的操作最终很厉害的哪个数据)
  导致的问题是我们可以通过原始数据来操作响应式数据,这是很不好的,因为我们既然都操作原始数据了,那么就不希望这个是响应式的,而且会造成代码混乱
  解决办法是在给响应式对象赋值时，如果准备赋的值是响应式数据那么就要将其转换为原始数据（读取响应式数据上的RAW_KEY属性（这个属性是Symbol类型，所以不会与用户定义的key冲突）），这样一来，通过原始数据读取到的所有值就都是原始数据了，而响应式数据不会受到影响，因为我们之前了深响应处理
  如果用户没有特意的使用shadowReactive()来创建响应式数据的话,通过响应式数据读取的所有值也会被转换为响应式数据,这就完美解决了数据污染的问题

  ---

### 其中set和map的解决方案

  ``` javascript
  // set的add方法
  const rawValue = value[RAW_KEY] || value
  let res = target.add(rawValue)
  // map的set方法
  const rawValue = value[RAW_KEY] || value
  // 我们直接将原始数据赋值给key
  // target.set(key, value)
  target.set(key, rawValue)
  // 普通对象和数组
  const rawValue = newValue[RAW_KEY] || newValue
  const res = Reflect.set(target, key, rawValue, receiver)
  ```

  ---
  **它们的处理方式其实都是一样的,只是在赋值时将响应式数据转换为原始数据,这样就不会影响到原始数据的正常使用也不会和响应式数据混淆混淆**
  