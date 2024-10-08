# Vue.js 核心逻辑

<p style="display: flex; justify-content: start; gap: 10px;">
  <a href="../README.md">首页</a>
  <a href="../analysis/README.md">上一页</a>
  <a href="../reactivity/README.md">下一页</a>
</p>

## 什么是响应式

  响应式是指数据的变化会自动反映到视图上,而不需要手动执行更新操作
  准确的说,数据的变化会自动执行读取数据的函数,从而实现所谓的试图更新,其实是重新执行了函数

### 响应式的基本原理

  把对象代理起来,然后把对象放在一个函数里执行,执行的目的是为了读取对象的值,读取值是为了触发对象的get,触发get是为了
  进行(依赖收集),收集完了以后修改的时候就能触发依赖的执行,实现响应式

### 如何进行依赖收集

  有一个注册副作用的函数,里面传入一个函数,这个函数就是副作用也就是所谓的依赖,会有一个全局变量来保存当前执行的副作用函数
  然后在进行依赖收集(track)时,会将当前执行的副作用函数和当前的对象内的key进行绑定

### 如何进行更新

  我们拦截一个对象的set,当这个对象的某个属性发生变化时,会触发这个属性所绑定的副作用函数,就这么简单,这就是响应式的基本原理

### 总结

  响应式的基本原理是拦截get和set,核心是保存住当前执行的副作用函数,当属性发生变化时,触发副作用函数,实现响应式
  但具体的实现显然要复杂许多,有许多细节需要处理,但这些就是响应式的核心的逻辑

## for in对key遍历时的处理

  使用for in遍历时,只有当可遍历对象的key数发生改变时才会触发 副作用函数重新执行(R),这么做没问题,因为for in的语义就是只关心key而不关心你用key做了什么,如果你用key读取了对象的值(a),那么这个值将来发生变化时就会触发R,这是完全符合预期的.如果我们没有用这个key做事情,或者将来改变了不是a的值,而是改变了这个对象中b的值,就不会触发R,这是符合预期的,所以不需要有心智负担

## for of对value进行变量的处理

  同理,我们如果在for of中使用了value,那value就会与副作用函数建立联系,当value发生变化时,副作用函数就会重新执行,这是完全符合预期的

## 为什么会有ref

  为了让原始值(Boolean,String,Number,Symbol,BigInt,undefined,null,NAN)也具有响应式,怎么做呢?proxy无法代理这些,所以必须对这些值进行封装,包裹一个对象呗,就是这么简单
  
  ``` javascript
  {
    value:原始值
  }
  ```
