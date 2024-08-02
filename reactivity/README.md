---
markdown:
  image_dir: /assets
  path: output.md
  ignore_from_front_matter: true
  absolute_image_path: false
export_on_save:
  markdown: true
---

# 响应式

<p style="display: flex; justify-content: start; gap: 10px;">
  <a href="../README.md">首页</a>
  <a href="../basic/README.md">上一页</a>
  <a href="../renderer/README.md">下一页</a>
</p>

+ 一句话概括：数据变化时，重新执行某个依赖这个数据的函数`fn`。s
+ 怎么实现的：拦截`get`（或其他可以读取的操作），收集函数`fn`；拦截`set`，触发函数`fn`。
  
## 基本概念

1. ### 副作用函数

     如果一个函数的执行会改变外部或全局变量，那么这个函数就被成为副作用函数
      **比如**: *在`function setH2Text`函数中里会将h2的内容设置为`obj.text`，那么当我们调用`setH2Text`时，h2的`innerText`也会随之改变，这就是副作用函数。*

2. ### 响应式数据

      如果一个数据的变化会导致副作用函数重新执行，那么这个数据就被成为响应式数据。

3. ### 处理器函数

      处理器函数，在创建proxy代理对象时，传入的第二个参数，其中可以包含可以拦截一个对象的所有内部方法的自定义函数，比如想拦截get操作:`obj.a`,它会调用`obj`上的`[[Get]]`方法,我们就可以书写这样的代码:

      ```javascript
      const obj = { a:"bar" }
      const proxy = new Proxy(obj,{
        get(target,key){
            console.log("成功拦截get操作")
            return target[key] //可以返回你想返回的任意数据 //return "foo"
        }
      })
      console.log(proxy.a) // 成功拦截get操作 "bar"
      ```

      set也是一样:

      ```javascript
      const obj = { a:"bar" }
      const proxy = new Proxy(obj,{
        set(target,key,value){  
            console.log("成功拦截set操作")
            target[key] = value //可以修改你想修改的任意数据 //target[key] = "foo"
            return true
        }
      })
      ```

      proxy.a = "foo" // 成功拦截set操作

4. ### 依赖和依赖收集

      所谓依赖收集指的就是将一个函数里的用到的变量通过某种方法(后面会讲到)收集起来，当这些变量中的一个或多个发生变换时重新执行这个函数，这也就是响应式的表象。

5. ### 依赖触发

      当某个变量的值发生变化时，会触发依赖这个变量的函数，执行这个函数，从而实现响应式的效果。

6. ### 依赖收集方式

      在vue3中，通过代理一个对象（普通对象{}，数组[]，集合`Set`、`Map`、`WeakMap`、`WeakSet`）的`get`，`set`等方法，在读取一个对象值时收集依赖和修改一个对象值的时候触发依赖，这就是依赖收集的方式。当然，除了拦截`get`和`set`还有`has`、`ownKeys`、`deleteProperty`等方法。总之代理的目的就是为了收集和触发依赖

7. ### 具体实现的大致思路(核心)

      `Vue`做的就是在`get`里运行`track(target,key)`函数进行依赖收集,然后再`set`里运行`trigger(target,key)`函数进行依赖触发。

      其中`track`函数大致如下:

      ``` javascript
      function track(target,key){
        if (!activeEffect || !shouldTrack) {
            return
        }
        let desMap = bucket.get(target)
        if (!desMap) {
            bucket.set(target, (desMap = new Map()))
        }
        let des = desMap.get(key)
        if (!des) {
            desMap.set(key, (des = new Set()))
        }
        des.add(activeEffect)
        // 将依赖集合添加到deps中,方便清除副作用函数
        activeEffect.deps.push(des)
      }
      ```

      可以看到

      `bucket`是一个`weakMap`，用来储存所有响应式数据的依赖，`key`是某个响应式数据，`value`是该响应式数据所依赖的副作用函数集合；

      `desMap`是一个`Map`，`key`是一个响应式数据的某个键，`value`是一个这个响应式数据的某个键所依赖的副作用函数集合；

      `des`是一个`set`，里面存放了某个响应式数据的某个键所依赖的副作用函数集合。

      至于怎么知道响应式数据在哪一个函数里执行了(这个函数就是我们需要的副作用函数)，其实就是activeEffect这个变量，我们提供一个`registerEffect`函数来注册一个副作用函数。

      大致为:

      ``` javascript
      function registerEffect(wantRegisterEffectFunction, options = {}) {
        const runEffect = () => {
            cleanup(runEffect)
            activeEffect = runEffect
            effectStack.push(runEffect)
            const res = wantRegisterEffectFunction()
            effectStack.pop()
            activeEffect = effectStack[effectStack.length - 1]
            return res
        }
        runEffect.deps = []
        runEffect.options = options
        if (!options.lazy) {
            runEffect()
        }
        return runEffect
        }
      ```

      在`registerEffect`内部，我们会将传入的副作用函数再包装一层,称为`runEffect`，然后我们将`activeEffect`赋值为`runEffect`，然后再执行传入的副作用函数，而在副作用函数里，我们会读取响应式数据，前文提到，我们拦截了响应式数据的`get`，然后在`get`处理器函数里运行了`track`函数，在`track`里我们会将当前的副作用函数添加到当前读取的`key`(比如`obj.a`)的依赖集合中，将来修改`obj.a`的值时，就会从bucket中找到这个响应式数据(`obj`)中的(`obj.a`)所对应的依赖集合，然后触发集合里的副作用函数，这样就大功告成了。

      当然,这只是大体的实现思路,具体实现还需要考虑许多边缘情况,比如

      + 如何判断一个值是不是真的被修改了,只有被修改了才需要触发依赖,而不是简单的只要调用了`set`方法就触发依赖。

        >解决办法：在set里先判断值是不是变化了，变化了再trigger，这里面又有NAN的处理，因为NAN !== NAN

      + 如何处理因为this指向导致的依赖没有被正确收集

        ``` javascript
        const obj = { 
            bar: 1,
            get foo(){
                return this.bar
            }
        }
        const proxy = new Proxy(obj,{
          get(target,key,receiver){
            return target[key] //this指向为obj,而不是proxy,这导致依赖没有被正确收集
            // return Reflect.get(target,key,receiver)
            // 可以解决this指向问题
          }
        })
        
        ```

        >解决办法是: 在`get`处理器中我们返回`Reflect.get(target,key,receiver)`,其中receiver是响应式对象本身,这样`Reflect.get`会正确的将`this`指向为响应式对象本身,从而收集依赖

      + 如何处理因为父子对象的属性继承导致副作用函数执行两次的问题,例如`子对象`没有`a属性`,但是`父对象`有`a属性`,那么当执行`子对象.a`时实际上会调用两次`get`方法,一次是调用`子对象`的`[[Get]]`发现没有`a属性`,于是就会读取`父对象`的`[[Get]]`,这就导致我们明明读取的是`子对象`,修改的也是`子对象`,但是会对父对象也进行依赖收集并且修改时也会触发父对象关联的副作用函数,导致副作用函数执行了两次
        >解决办法：在每个响应式属性上设置一个`Raw`属性,这个属性的值是响应式属性的原始值,在track之前判断`receiver[Raw]`是否是当前操作的原始属性,因为我们操作的是`子对象`,即使进入到`父对象`拦截的`get`处理器时`receiver`也是`子对象`,因为receiver始终指向当前操作的对象,所以我们可以根据这点来判断当前将要收集依赖的对象是不是我们当前操作的.
        >即使用:`receiver[Raw] === receiver`来判断拦截的对象是否是当前操作的对象.
