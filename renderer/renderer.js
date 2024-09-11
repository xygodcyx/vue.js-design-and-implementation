const minRenderer = (function (exports) {
  const Text = Symbol() // 描述文本节点
  const Comment = Symbol() // 描述注释节点
  const Fragment = Symbol() // 描述片段节点
  const { effect, reactive, computed, shallowReactive, shallowReadonly, ref, shallowRef } =
    typeof VueReactivity === 'undefined' ? minReactive : VueReactivity
  const { watch } = minReactive

  function createRenderer(options) {
    const {
      createElement,
      setElementText,
      insert,
      removeDom,
      patchProps,
      createText,
      createComment,
      setText,
    } = options

    function unmount(vnode) {
      console.log('开始卸载组件', vnode)
      if (vnode.type === Fragment) {
        // fragment需要逐个卸载子节点
        console.log('卸载Fragment的子节点', vnode.children)
        vnode.children.forEach((c) => unmount(c))
        return
      }
      if (Array.isArray(vnode.children)) {
        console.log('卸载很多个子节点', vnode.children)
        vnode.children.forEach((c) => unmount(c))
        return
      }
      if (typeof vnode.type === 'object' || vnode.component) {
        // 是组件,然后卸载
        console.log('卸载组件节点', vnode)
        if (vnode.shouldKeepAlive) {
          // 需要保持激活
          console.log('已经被shouldKeepAlive,不需要卸载,将其设置为非激活即可')
          vnode.keepAliveInstance._deActivate(vnode)
        } else {
          // 不需要保持激活
          unmount(vnode.component.subTree)
        }
        return /*  要return,不然会多执行一次unmount,导致多执行的那次找不到parentNode*/
      }
      console.log('正在卸载这个虚拟dom节点', vnode)
      console.log('要移除的dom元素', vnode.el)
      // 解决组件卸载会递归2次的问题
      const parent = vnode.el.parentNode
      if (parent) {
        const performance = () => removeDom(parent, vnode.el)
        if (vnode.transition) {
          vnode.transition.leave(vnode.el, performance)
        } else {
          performance()
        }
      }
    }

    function render(vnode, container) {
      if (vnode) {
        // 挂载或更新
        patch(container._vnode /* 旧vnode */, vnode /* 新vnode */, container /* 父容器 */)
      } else {
        // 卸载
        if (container._vnode) {
          unmount(container._vnode)
        } else {
          console.warn('旧节点不存在,无法卸载')
        }
      }
      // 标记container的vnode,此后可以根据container._vnode判断是否存在虚拟节点然后以此判断是需要更新还是卸载
      container._vnode = vnode
    }
    // n1旧 n2新
    /**
     * patch第一个参数为null时,意为挂载节点,否则进行更新
     */
    function patch(n1, n2, container, anchor = null) {
      if (n1 && n2 && n1.type !== n2.type) {
        // 类型不同，需要卸载旧节点，然后挂载新节点
        console.log(`发现类型不同,开始卸载组件 n1:${JSON.stringify({ who: n1.type })}`)
        unmount(n1)
        n1 = null
      }
      // n1和n2的容器是一样的,因为如果不一样在一开始就会执行挂载操作(container._vnode不存在)
      // 运行到这里,有两种情况:
      // 1. n1和n2都存在且类型相同,需要更新
      // 2. n1不存在,n2存在,需要卸载n1
      const { type } = n2
      if (typeof type === 'string') {
        // 普通html元素
        if (!n1) {
          // 旧的节点不存在，需要挂载新节点
          console.log('挂载虚拟dom元素(原生html元素)', n2)
          mountElement(n2, container, anchor)
        } else {
          // 打补丁(更新)
          /* 因为是html节点,所以有属性,所以需要更新props,而别的节点不需要更新props(除了组件) */
          console.log('更新虚拟dom元素(原生html元素)', 'n1:', n1, 'n2:', n2)
          patchElement(n1, n2)
        }
      } else if (type === Text) {
        // 文本节点
        if (!n1) {
          // 如果n1不存在,则需要创建文本节点
          console.log('挂载虚拟dom元素(文本节点)', n2)
          const el = (n2.el = createText(n2.children))
          insert(container, el)
        } else {
          // 如果n1存在,并且n1和n2的children /* 实际内容 */ 不同,则需要更新文本节点
          console.log('更新虚拟dom元素(文本节点)', 'n1:', n1, 'n2:', n2)
          const el = (n2.el = n1.el)
          if (n1.children !== n2.children) {
            setText(el, n2.children)
          }
        }
      } else if (type === Comment) {
        // 注释节点
        if (!n1) {
          console.log('挂载虚拟dom元素(注释节点)', n2)
          const el = (n2.el = createComment(n2.children))
          insert(container, el)
        } else {
          console.log('更新虚拟dom元素(注释节点)', 'n1:', n1, 'n2:', n2)
          // 如果n1存在,并且n1和n2的children不同,则需要更新注释节点
          const el = (n2.el = n1.el)
          if (n1.children !== n2.children) {
            setText(el, n2.children)
          }
        }
      } else if (type === Fragment) {
        // fragment节点
        if (!n1) {
          console.log('挂载虚拟dom元素(Fragment节点)', n2)
          // 如果n1不存在,逐个挂载子节点即可,因为是fragment节点,不需要挂载父节点
          n2.children.forEach((c) => patch(null, c, container))
        } else {
          console.log('更新虚拟dom元素(Fragment节点)', 'n1:', n1, 'n2:', n2)
          // 如果n1存在,那么只需要更新fragment节点的children即可(因为fragment节点没有真实节点也就没有各种dom属性)
          /* 走patchChildren不会错,因为patchelement里最终会执行patch(对children进行patch) */
          patchChildren(n1, n2, container)
        }
      } else if (typeof type === 'object' && type.__isTeleport) {
        // 是teleport组件,单独渲染
        type.process(n1, n2, container, anchor, {
          patch,
          patchChildren,
          unmount,
          move(vnode, container, anchor) {
            insert(container, vnode.component ? vnode.subTree.el : vnode.el, anchor)
          },
        })
      } else if (typeof type === 'object' || typeof type === 'function') {
        // 组件,可以使有状态的普通组件,也可以是无状态的函数组件(没有data和生命周期的组件)
        if (!n1) {
          console.log('挂载虚拟dom元素(组件)', n2)
          if (n2.keptAlive) {
            console.log('已经被KeepAlive,不需要挂载,激活该组件即可')
            n2.keepAliveInstance._activate(n2, container, anchor)
          } else {
            mountComponent(n2, container, anchor)
          }
        } else {
          console.log('更新虚拟dom元素(组件)', 'n1:', n1, 'n2:', n2)
          patchComponent(n1, n2, container, anchor)
        }
        // 组件
      } else if (typeof type === '??') {
        // 其他
      }
    }
    /* 先更新自身的属性(props),然后更新子节点,子节点最终会调用patch进行挂载或更新,为什么调用patch呢?
     因为无法子节点的类型无法确定,所以全部过一遍patch确保每一种子节点都能被正确处理
  */
    function patchElement(n1, n2) {
      const el = (n2.el = n1.el) /* 拿到自身的dom节点,因为自己的子节点的容器是这个 */
      // 更新属性
      const oldProps = n1.props
      const newProps = n2.props
      for (const key in newProps) {
        if (oldProps[key] !== newProps[key]) {
          patchProps(el, key, oldProps[key], newProps[key])
        }
      }
      for (const key in oldProps) {
        if (!(key in newProps)) {
          // 新节点删除了属性
          patchProps(el, key, oldProps[key], null)
        }
      }
      // 更新子节点
      patchChildren(n1, n2, el /* 把自己的真实dom作为子节点的容器 */)
    }
    /**
  更新子节点时,理论上有九种情况的自由组合
  即:
  新节点为文本节点,旧节点为三种节点之一
  新节点为数组,旧节点为三种节点之一
  新节点为null,旧节点为三种节点之一
  但实际上不需要这么多情况
  */
    /* 更新子节点 */
    function patchChildren(n1, n2, container) {
      if (typeof n2.children === 'string') {
        // 新节点是文本节点
        if (Array.isArray(n1.children)) {
          // 旧节点是数组,需要先卸载旧节点
          n1.children.forEach((c) => unmount(c))
        }
        // 然后设置文本节点,无论是旧节点是字符串还是null,都需要设置为文本节点
        if (n1.children !== n2.children) {
          setElementText(container, n2.children)
        }
      } else if (Array.isArray(n2.children)) {
        // 新节点是数组
        if (Array.isArray(n1.children)) {
          // 旧节点也是数组，这里涉及diff算法
          const oldChildren = n1.children
          const newChildren = n2.children
          // simpleDiff(oldChildren, newChildren, container) // 简单diff算法
          // doubleEndDiff(oldChildren, newChildren, container) // 双端diff算法
          quickDiff(oldChildren, newChildren, container) // 快速diff算法
        } else {
          // 旧节点是文本或null
          // 无论是那种情况,都需要先清空旧节点,然后挂载新节点
          setElementText(container, '')
          n2.children.forEach((c) => patch(null, c, container))
        }
      } else {
        // 新节点是null,即容器只是一个空标签,里面没有内容,但是存在元素 eg: <div></div>
        if (Array.isArray(n1.children)) {
          // 旧节点是数组
          // 需要先卸载旧节点
          n1.children.forEach((c) => unmount(c))
        }
        // 旧节点是文本或null
        // 无论是那种情况,都只需要清空容器的文本内容即可
        setElementText(container, '')
      }
    }
    function simpleDiff(oldChildren, newChildren, container) {
      console.time('simpleDiff')
      let lastIndex = 0
      // 更新、移动和添加
      for (let i = 0; i < newChildren.length; i++) {
        const newVNode = newChildren[i]
        let j = 0
        let find = false
        for (j; j < oldChildren.length; j++) {
          const oldVNode = oldChildren[j]
          if (oldVNode.key === newVNode.key) {
            /* 因为不知道子节点里有什么,所以一定要调用patch */
            patch(oldVNode, newVNode, container)
            /* patch完了(属性改变了,或者新旧节点的children需要更新)就需要改变位置了*/
            find = true
            if (j < lastIndex) {
              // 如果当前找到的节点在旧children中的索引小于最大索引lastIndex
              // 说明该节点对应的真实dom需要移动
              // 第一个想到这个算法的人简直是天才,天才...
              // *画图画图,遇到靠想象理解不了的情况就画图,不要硬想,画图更直观
              const el = (oldChildren[j].el = newChildren[i].el)
              /* 不能直接移动,因为如果旧子节点的顺序不是递增的,就会导致顺序混乱 */
              const prevNode = newChildren[i - 1]

              if (prevNode) {
                /* 拿到前一个节点的下一个节点的真实dom,这是原生JavaScript的api */
                const anchor = prevNode.el.nextSibling
                // 获取anchor的思想也极其巧妙,如果没有anchor,那么就说明不需要
                // 移动的元素在旧节点树的最后,那就直接插入到最后即可
                // 因为更新的目的就是把当前找到的节点的真实dom插入到新节点的真实dom后面(按新节点的顺序)
                insert(container, el, anchor)
              } else {
                // 如果prevNode不存在,那么说明是第一个节点,那么不需要移动,因为它的第一个,其他的旧节点应该移动到它的后面
              }
            } else {
              lastIndex = j
            }
            break
          }
        }
        if (!find) {
          // 遍历完了,没找到相同的key,则需要创建(挂载)新节点
          let anchor = null
          const prevNode = newChildren[i - 1]
          if (prevNode) {
            // 有前一个节点,那就把需要挂载的新节点添加到前一个节点的后面(通过
            // 前一个节点的的真实dom的后一个节点来确定插入位置)
            anchor = prevNode.el.nextSibling /* 拿到前一个节点的下一个节点的真实dom */
          } else {
            // 如果没有前一个节点,说明要添加的新节点是第一个节点,那么就用容器的第一个节点来确定插入位置
            anchor = container.firstChild
          }
          patch(null, newVNode, container, anchor)
        }
      }
      // 删除,等更新完毕了再遍历一次旧节点,如果在新节点中找不到与之对应的key,那么就要卸载
      for (let i = 0; i < oldChildren.length; i++) {
        const has = newChildren.find((c) => c.key === oldChildren[i].key)
        if (!has) {
          unmount(oldChildren[i])
        }
      }
      console.timeEnd('simpleDiff')
    }
    function doubleEndDiff(oldChildren, newChildren, container) {
      console.time('doubleEndDiff')
      // 四个索引值
      let oldStartIndex = 0
      let oldEndIndex = oldChildren.length - 1
      let newStartIndex = 0
      let newEndIndex = newChildren.length - 1
      // 四个索引指向的vnode节点
      let oldStartVNode = oldChildren[oldStartIndex]
      let oldEndVNode = oldChildren[oldEndIndex]
      let newStartVNode = newChildren[newStartIndex]
      let newEndVNode = newChildren[newEndIndex]
      while (oldStartIndex <= oldEndIndex && newStartIndex <= newEndIndex) {
        // 因为我们只会改变旧节点的vnode,所以只处理旧节点为undefined的情况就行了
        if (!oldStartVNode) {
          oldStartVNode = oldChildren[++oldStartIndex]
        } else if (!oldEndVNode) {
          oldEndVNode = oldChildren[--oldEndIndex]
        } else if (newStartVNode.key === oldStartVNode.key) {
          // 第一步,比较旧的第一个节点和新的第一个节点
          patch(oldStartVNode, newStartVNode, container) /* 先打完补丁 */
          // 不需要移动,因为都在头部,所以不需要移动
          // 然后更新索引值
          oldStartVNode = oldChildren[++oldStartIndex] /* 将旧的开始指针往后移动 */
          newStartVNode = newChildren[++newStartIndex] /* 将新的开始指针往后移动 */
        } else if (newEndVNode.key === oldEndVNode.key) {
          // 第二步,比较旧的最后一个节点和新的最后一个节点
          patch(oldEndVNode, newEndVNode, container) /* 先打完补丁 */
          // 不需要移动,因为都在尾部,所以不需要移动
          // 然后更新索引值
          oldEndVNode = oldChildren[--oldEndIndex] /* 将旧的末端指针往前移动 */
          newEndVNode = newChildren[--newEndIndex] /* 将新的末端指针往前移动 */
        } else if (newEndVNode.key === oldStartVNode.key) {
          // 第三步,比较旧的第一个节点和新的最后一个节点
          patch(oldStartVNode, newEndVNode, container) /* 先打完补丁 */
          // 移动节点
          insert(container, oldStartVNode.el, oldEndVNode.el.nextSibling)
          newEndVNode = newChildren[--newEndIndex] /* 将新的末端指针往前移动 */
          oldStartVNode = oldChildren[++oldStartIndex] /* 将旧的开始指针往后移动 */
        } else if (newStartVNode.key === oldEndVNode.key) {
          // 第四步,比较旧的最后一个节点和新的第一个节点
          patch(oldEndVNode, newStartVNode, container) /* 先打完补丁 */
          // 如果新的第一个节点和旧的最后一个节点的key相同了,那就说明要把旧的最后一个节点移动到旧的第一个元素前面(移动节点)
          insert(container, oldEndVNode.el, oldStartVNode.el)
          // 然后更新索引值
          oldEndVNode = oldChildren[--oldEndIndex] /* 将旧的末端指针往前移动 */
          newStartVNode = newChildren[++newStartIndex] /* 将新的开始指针往后移动 */
        } else {
          // 如果某一轮比较都没找到相同的key,那就找头部节点,先移动头部节点,总会找到的
          const indexInOld = oldChildren.findIndex((c) => c.key === newStartVNode.key)
          if (indexInOld > 0) {
            // 如果找到了,那就把新头部节点对应的旧节点移动到前面
            const vnodeToMove = oldChildren[indexInOld]
            // 先patch
            patch(vnodeToMove, newStartVNode, container)
            // 把准备移动的节点移动到旧节点的头部节点前面
            insert(container, vnodeToMove.el, oldStartVNode.el.el)
            // 清空移动节点对应的旧节点
            oldChildren[indexInOld] = undefined
            // 更新新children的索引值到下一个
          } else {
            // 如果没找到(新节点的头部节点在旧节点中没有),那就创建新节点,并挂载到旧节点的头部节点(真实dom顺序)前面
            patch(null, newStartVNode, container, oldStartVNode.el)
          }
          newStartVNode = newChildren[++newStartIndex]
        }
      }
      if (oldEndIndex < oldStartIndex && newStartIndex <= newEndIndex) {
        // 说明在diff中有遗漏的节点(比如:新4123,旧123),需要挂载
        for (let i = newStartIndex; i <= newEndIndex; i++) {
          const anchor = newChildren[newEndIndex + 1] ? newChildren[newEndIndex + 1].el : null
          patch(null, newChildren[i], container, anchor)
        }
      } else if (newEndIndex < newStartIndex && oldStartIndex <= oldEndIndex) {
        // 说明在diff中多余的节点(比如:新13,旧123),需要卸载
        for (let i = oldStartIndex; i <= oldEndIndex; i++) {
          unmount(oldChildren[i])
        }
      }
      console.timeEnd('doubleEndDiff')
    }
    function quickDiff(oldChildren, newChildren, container) {
      // 更新相同的前置节点(开头相同的节点)
      let j = 0
      let oldVNode = oldChildren[j]
      let newVNode = newChildren[j]
      while (oldVNode && oldVNode.key === newVNode.key) {
        patch(oldVNode, newVNode, container)
        j++
        oldVNode = oldChildren[j]
        newVNode = newChildren[j]
      }
      if (j === oldChildren.length && j === newChildren.length) {
        // 说明这一遍已经更新完毕了,不需要继续更新了
        return
      }
      // 更新相同的后置节点(末尾相同的节点)
      let oldEndIndex = oldChildren.length - 1
      let newEndIndex = newChildren.length - 1
      oldVNode = oldChildren[oldEndIndex]
      newVNode = newChildren[newEndIndex]
      while (oldVNode && oldVNode.key === newVNode.key) {
        patch(oldVNode, newVNode, container)
        oldEndIndex--
        newEndIndex--
        oldVNode = oldChildren[oldEndIndex]
        newVNode = newChildren[newEndIndex]
      }
      if (newEndIndex >= j && oldEndIndex < j) {
        // 有遗留的新节点,需要添加
        const anchorIndex = newEndIndex + 1
        const anchor = anchorIndex < newChildren.length ? newChildren[anchorIndex].el : null
        while (newEndIndex >= j /* 因为j在++,会有一刻newEndIndex < j */) {
          patch(null, newChildren[j++], container, anchor)
        }
      } else if (newEndIndex < j && oldEndIndex >= j) {
        // 有遗留的旧节点,需要卸载
        while (oldEndIndex >= j /* 因为j在++,会有一刻newEndIndex < j  */) {
          unmount(oldChildren[j++])
        }
      } else {
        // 非理想情况
        const count = newEndIndex - j + 1 /* 算出没有被处理的新节点的数量 */
        const sources = new Array(count)
        sources.fill(-1)
        const oldStart = j
        const newStart = j
        let moved = false
        let pos = 0
        const keyIndex = {}
        for (let i = newStart; i <= newEndIndex; i++) {
          keyIndex[newChildren[i].key] = i
        }
        let patched = 0
        for (let i = oldStart; i <= oldEndIndex; i++) {
          oldVNode = oldChildren[i]
          if (patched <= count) {
            const k = keyIndex[oldVNode.key]
            if (typeof k !== 'undefined') {
              newVNode = newChildren[k]
              patch(oldVNode, newVNode, container)
              patched++
              sources[k - newStart] = i
              if (k < pos) {
                // 更新
                moved = true
              } else {
                pos = k
              }
            } else {
              // 在旧节点中没找到与新节点对应的k,需要卸载
              unmount(oldVNode)
            }
          } else {
            // 旧节点的长度大于新节点的长度,需要卸载
            unmount(oldVNode)
          }
        }
        if (moved) {
          /*
        获取sources的最长递增子序列,拿到子序列在source中的最长递增子索引序列,
        在这个索引序列中相对应的节点不需要移动(因为已经是递增的状态了(在旧节点中的顺序是递增的))
        */
          const seq = getSequence(sources)
          let s = seq.length - 1
          let i = count - 1
          for (i; i >= 0; i--) {
            if (sources[i] === -1) {
              // 需要挂载
              const pos = newStart + i /* 需要挂载的节点在新节点中的位置 */
              const newVNode = newChildren[pos]
              const nextPos = pos + 1
              const anchor = nextPos < newChildren.length ? newChildren[nextPos].el : null
              patch(null, newVNode, container, anchor)
            } else if (i !== seq[s]) {
              // 需要移动
              const pos = newStart + i
              const newVNode = newChildren[pos]
              const nextPos = pos + 1
              const anchor = nextPos < newChildren.length ? newChildren[nextPos].el : null
              // 移动操作
              insert(container, newVNode.el, anchor)
            } else {
              // 不需要移动
              s--
            }
          }
        }
      }
    }

    function mountElement(vnode, container, anchor = null) {
      // 将vnode的真实节点保存到el中,为了后续的更新和卸载
      const el = (vnode.el = createElement(vnode.type)) // 创建元素(真实dom)
      if (typeof vnode.children === 'string') {
        // 子节点是文本
        setElementText(el, vnode.children)
      } else if (Array.isArray(vnode.children)) {
        // 子节点是数组
        /* 先递归调用patch生成子节点(insert到el中),再生成父节点(insert到container中) */

        vnode.children.forEach((child) => patch(null, child, el))
      } else if (vnode.children === null) {
        // 空节点
        setElementText(el, '')
      } else {
        throw new Error('children must be a string or an array or null')
      }

      if (vnode.props) {
        for (const key in vnode.props) {
          // 挂载时
          patchProps(el /* 要设置属性的元素 */, key, null, vnode.props[key])
        }
      }
      const needTransition = vnode.transition
      if (needTransition) {
        // 需要过渡
        vnode.transition.beforeEnter(el)
      }
      insert(container, el, anchor) // 挂载节点到父容器(真实dom) (会等到所有子节点都insert完毕了才会insert自己)
      if (needTransition) {
        vnode.transition.enter(el)
      }
    }
    let currentInstance = null
    function mountComponent(vnode, container, anchor) {
      const isFunction = typeof vnode.type === 'function'
      let componentOptions = vnode.type /* 一个虚拟dom描述的组件类型 */
      if (isFunction) {
        componentOptions = {
          render: vnode.type /* 函数组件的type是一个函数,这个函数会返回要渲染的虚拟dom */,
          props:
            vnode.type.props /* 可以在这个函数上添加props,render中的this执行和普通有状态组件无异 */,
        }
      }
      let {
        render,
        data,
        props: propsOptions /* 这是组件上的props(定义的props,比如我要title,我要name) */,
        methods /* 方法 */,
        computed: computedOptions /* 计算属性 */,
        watch: watchOptions /* 监听 */,
        setup /* setup语法 */,
        beforeCreate,
        created,
        beforeMount,
        mounted,
        beforeUpdate,
        updated,
      } = componentOptions

      beforeCreate && beforeCreate()
      const state = data ? reactive(data()) : null
      /* vnode.props是虚拟节点上的props,是传递给组件的props值(实际的值,给你title,给你name) */
      /* propsOptions是在组件(一个配置对象)上定义的props,期望使用这个组件时传入的props */
      const [props, attrs] = resolveProps(propsOptions, vnode.props)
      function emit(event, ...payload) {
        const eventName = `on${event[0].toUpperCase()}${event.slice(1)}`
        /* 在组件实例上找到这个函数,然后调用,并把参数传给它,这个组件实例是一个组件的整体实例,即虚拟dom上的实例*/
        const handle = instance.props[eventName]
        if (handle) {
          handle(...payload)
        } else {
          console.error(`${event}事件不存在`)
        }
      }
      // setup语法实现
      const slots = vnode.children || {}
      const setupContext = { attrs, emit, slots }
      const instance = {
        state,
        props: shallowReactive(props),
        attrs /* 不是响应式的 */,
        isMounted: false,
        methods: methods || {},
        watch: watchOptions,
        computed: computedOptions,
        subTree: null,
        slots,
        mounteds: [],
        keepAliveCtx: null,
      }
      const isKeepAlive = vnode.type.__isKeepAlive
      if (isKeepAlive) {
        instance.keepAliveCtx = {
          move(vnode, container, anchor) {
            insert(container, vnode.component.subTree.el, anchor)
          },
          createElement,
        }
      }
      setCurrentInstance(instance)
      const setupResult = (setup && setup(shallowReadonly(instance.props), setupContext)) || null
      setCurrentInstance(null) //在执行完setup函数后清除这个变量,目的是为了不在setup以外的地方调用onXXX生命周期函数
      let setupState = null
      if (typeof setupResult === 'function') {
        // setup返回了一个渲染函数(约定)
        if (render) {
          console.error('setup函数已经返回了渲染函数,render函数无效')
        }
        render = setupResult
      } else if (setupResult) {
        // 没有返回,那就要指定渲染函数,如果没有,那就报错
        if (!render) {
          console.error('setup函数没有返回渲染函数,请指定render函数')
        }
        setupState = setupResult
      } else {
        if (!render) {
          console.error('setup函数不存在而且没有指定render函数,请指定render函数')
        }
      }

      vnode.component = instance

      /* 这个上下文的作用就是当用户使用数据时可以不用考虑是state还是props等等,可以无压力的使用数据
       因为vue会根据k在那个属性上从而动态的返回响应的数据
    */
      const renderContext = new Proxy(instance, {
        get(t, k, r) {
          const { state, props, methods, computed, slots } = t
          if (state && k in state) {
            return state[k]
          } else if (k in props) {
            return props[k]
          } else if (k in attrs) {
            return attrs[k]
          } else if (k in methods) {
            return methods[k]
          } else if (k in computed) {
            return computed[k]
          } else if (setupState && k in setupState) {
            return setupState[k]
          } else if (k === 'computed') {
            return computed
          } else if (k === '$emit') {
            return emit
          } else if (k === '$slots') {
            return slots
          } else {
            console.error(`读取失败,${k}不在vnode上`)
          }
        },
        set(t, k, v, r) {
          const { state, props } = t
          if (state && k in state) {
            state[k] = v
          } else if (k in attrs) {
            attrs[k] = v
          } else if (setupState && k in setupState) {
            setupState[k] = v
          } else if (k in props) {
            console.warn(`试图修改prop${k},属性是只读的`)
          } else {
            console.error(`修改失败,${k}不在vnode上`)
          }
          return true
        },
      })
      // computed
      instance.computed = resolveComputed(computedOptions, renderContext)
      // watch
      instance.watch = resolveWatch(watchOptions, renderContext)

      created && created.call(renderContext)
      /* 只有在effect函数里调用响应式数据时才会被track依赖,因为我们在effect里对activeEffect进行了赋值
       如果在effect之外使用了响应式数据,那依然不会被track依赖,因为在track中首先就判断activeEffect是否存在,而在
       别处使用响应式数据时并不会初始化activeEffect,所以依赖就不会被收集,这也是为什么必须要在setup函数中暴露想要
       收集依赖的响应式数据的原因,而未被暴露的响应式数据可能会在别的地方用到,但只会被使用一次,其所处的函数也不会被收集为依赖
       比如生命周期函数,在生命周期函数中使用的响应式数据和普通对象无异,不具有响应式的特性,即:数据改变后不会触发生命周期函数重新执行.

      */
      effect(
        () => {
          /* 会返回一个vnode节点,然后就以vnode的处理方式进行patch挂载,子节点会自动的递归处理 */
          const subTree = render.call(renderContext, renderContext)
          if (!instance.isMounted) {
            beforeMount && beforeMount.call(renderContext)
            console.log('初始化组件:', 'subTree', subTree)
            patch(null, subTree, container, anchor) /* 挂载组件上的vnode */
            instance.isMounted = true
            mounted && instance.mounteds.push(mounted)
            instance.mounteds.forEach((mounted) => mounted && mounted.call(renderContext))
          } else {
            console.log('更新组件:', 'subTreeOld', instance.subTree, 'subTreeNew', subTree)
            beforeUpdate && beforeUpdate.call(renderContext)
            patch(instance.subTree, subTree, container, anchor) /* 更新组件上的vnode */
            updated && updated.call(renderContext)
          }
          instance.subTree = subTree
        },
        {
          scheduler: useQueueJob(),
        }
      )
    }
    function defineAsyncComponent(options) {
      if (typeof options === 'function') {
        options = {
          loader: options,
        }
      }
      /* 这个loader函数会返回一个promise,用来动态加载组件 */
      const { loader, onError } = options

      let innerCom = null

      /* 返回一个组件的配置对象 */
      return {
        name: 'AsyncComponent',
        setup(props, { emit, attrs }) {
          const isLoaded = ref(false)
          const isLoading = ref(false)
          const error = shallowRef(null)
          let loadingTimer = null
          let timeoutTimer = null
          // 延迟一会加载组件,避免加载太快导致页面闪烁(比如200ms后显示加载页面)
          if (options.delay) {
            loadingTimer = setTimeout(() => {
              isLoading.value = true
            }, options.delay)
          } else {
            isLoading.value = true
          }
          let retries = 1
          function load() {
            return loader().catch((err) => {
              if (onError) {
                // 重新加载组件
                error.value = err
                return new Promise((resolve, reject) => {
                  const retry = () => {
                    retries++
                    resolve(load())
                  }
                  const fail = () => {
                    reject(err)
                  }
                  onError(retry, fail, retries, error.value)
                })
              } else {
                throw err
              }
            })
          }

          load()
            .then((com) => {
              innerCom = com
              isLoaded.value = true
            })
            .catch((err) => {
              error.value = err
            })
            .finally(() => {
              // 成功和出错都会进入finally
              isLoading.value = false
              clearTimeout(loadingTimer)
              clearTimeout(timeoutTimer)
            })
          // 超时检查
          if (options.timeout) {
            timeoutTimer = setTimeout(() => {
              isLoaded.value = false
              const err = new Error('加载组件超时了')
              error.value = err
            }, options.timeout)
          }
          const placeholder = options.placeholderComponent
            ? { type: options.placeholderComponent }
            : {
                type: Text,
                children: '',
              }
          return () => {
            // 要渲染的东西,如果加载成功了就渲染加载后的组件,没有的话就渲染占位符
            // 因为isLoaded是响应式的,所以这些代码会在isLoaded被改变后重新执行,也就是会重新渲染
            if (isLoaded.value) {
              return { type: innerCom }
            } else if (error.value) {
              console.log('渲染错误组件')
              // 如果超时了,那就要渲染错误组件,否则就只渲染占位符
              console.log(options.errorComponent)
              return options.errorComponent ? { type: options.errorComponent } : placeholder
            }
            // 即没加载出来也没有超时,那就先渲染占位符
            return placeholder
          }
        },
      }
    }
    const KeepAlive = {
      name: 'KeepAlive',
      __isKeepAlive: true,
      props: {
        include: {
          type: RegExp,
          default: '',
        },
        exclude: {
          type: RegExp,
          default: '',
        },
      },
      setup(props, { slots }) {
        // 缓存要保持激活的组件,key是组件的配置对象(type,value是组件本身(vnode,即虚拟dom))
        const cache = new Map()
        /* 当前创建的组件示例,也就是KeepAlive组件的示例此处定义的KeepAlive只是一个
         配置对象(所有的组件都是这样,完成主要代码的是个配置对象,而组件实例从配置
         对象上获取各种配置,如data,computeds,watchs,methods),也就是如何描述这个组件,真正的组件是组件的示例
      */
        const instance = currentInstance
        const { move, createElement } = instance.keepAliveCtx
        const storageContainer = createElement('div')
        // 假装卸载,其实是把这个vnode移到一个没有被添加到一个游离节点中,让其不显示在页面上
        // move函数:移动一个虚拟节点到任意位置
        instance._deActivate = (vnode) => {
          move(vnode, storageContainer)
        }
        instance._activate = (vnode, container, anchor) => {
          move(vnode, container, anchor)
        }
        return () => {
          const rawVnode = slots.default()
          console.log('rawVnode', rawVnode)
          if (typeof rawVnode.type !== 'object' && typeof rawVnode.type !== 'function') {
            // 说明不是组件,非组件不能被keepAlive
            console.log('这不是组件,不能缓存在KeepAlive组件里')
            return rawVnode
          }
          // TODO根据要保持活性的组件的名字来查找哪些组件确实需要缓存或者不需要缓存
          const name = rawVnode.name
          if (name) {
            if (
              (props.include && props.include.test(name)) ||
              (props.exclude && props.exclude.test(name))
            ) {
              return rawVnode
            }
          }
          // 组件
          const cacheVnode = cache.get(rawVnode.type)
          if (cacheVnode) {
            // 说明之前显示过这个组件,那就直接使用之前的组件实例
            rawVnode.component = cacheVnode.component
            // 标记是已经被缓存了,避免渲染器重复挂载,而是执行active方法
            rawVnode.keptAlive = true
          } else {
            // 如果没有,那就需要执行首次挂载,并缓存这个虚拟dom
            // 如果没有,那就不需要标记被缓存,因为需要挂载
            cache.set(rawVnode.type, rawVnode)
          }
          // 避免卸载时渲染器将其卸载掉,而是执行deActive方法
          rawVnode.shouldKeepAlive = true
          rawVnode.keepAliveInstance = instance
          return rawVnode
        }
      },
    }
    const Teleport = {
      name: 'Teleport',
      __isTeleport: true,
      process(n1, n2, container, anchor, internals) {
        const { patch, patchChildren, move } = internals
        if (!n1) {
          // 挂载
          const target =
            typeof n2.props.to === 'string' ? document.querySelector(n2.props.to) : n2.props.to
          // teleport组件实例上的children是要传送的虚拟节点,不是以插槽的形式(其实也可以,但是没有)
          n2.children.forEach((c) => patch(null, c, target, anchor))
        } else {
          patchChildren(n1, n2, container)
          if (n1.props.to !== n2.props.to) {
            const newTarget =
              typeof n2.props.to === 'string' ? document.querySelector(n2.props.to) : n2.props.to
            n2.children.forEach((c) => move(c, newTarget))
          }
        }
      },
    }
    const Transition = {
      name: 'Transition',
      props: {
        name: String,
      },
      setup(props, { slots }) {
        return () => {
          const name = props.name
          // TODO 可变的name类名
          const innerVnode = slots.default()
          const handleEnterTransitionEnd = (el) => {
            el.classList.remove('enter-to')
            el.classList.remove('enter-active')
            el.removeEventListener('transitionend', handleEnterTransitionEnd)
          }
          const handleLeaveTransitionEnd = (el, performance) => {
            el.classList.remove('leave-to')
            el.classList.remove('leave-active')
            performance()
            el.removeEventListener('transitionend', handleLeaveTransitionEnd)
          }
          if (innerVnode !== null) {
            if (innerVnode.type !== Text && innerVnode.type !== Comment) {
              innerVnode.transition = {
                beforeEnter(el) {
                  // 元素还没有出现在html文档中,但是元素已经通过createElement生成出来
                  el.classList.add('enter-form')
                  el.classList.add('enter-active')
                },
                enter(el) {
                  // 元素已经被添加到html文档中,将在当前帧被绘制出来,所以我们等待一帧,在下一帧应用enter-to的样式
                  nextFrame(() => {
                    el.classList.remove('enter-form')
                    el.classList.add('enter-to')
                    el.addEventListener('transitionend', handleEnterTransitionEnd.bind(null, el))
                  })
                },
                leave(el, performRemove) {
                  el.classList.add('leave-form')
                  el.classList.add('leave-active')
                  // 强制reflow,使样式添加生效(设置位置等)
                  document.body.offsetHeight
                  nextFrame(() => {
                    el.classList.remove('leave-form')
                    el.classList.add('leave-to')
                  })
                  el.addEventListener(
                    'transitionend',
                    handleLeaveTransitionEnd.bind(null, el, performRemove)
                  )
                },
              }
            }
          }
          return innerVnode
        }
      },
    }
    // 在下一帧调用fn
    function nextFrame(fn) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fn()
        })
      })
    }

    function onMounted(fn) {
      if (currentInstance) {
        console.log('当前挂载的组件实例', currentInstance)
        currentInstance.mounteds.push(fn)
      } else {
        // 不存在,给一个警告
        console.warn('onMounted函数只能在setup中调用')
      }
    }
    function onUnmounted() {}
    function setCurrentInstance(instance) {
      currentInstance = instance
    }
    function resolveComputed(computeds, ctx) {
      const res = {}
      for (const key in computeds) {
        const getter = computeds[key]
        if (typeof getter !== 'function') {
          console.warn(`${key}不是getter`)
          continue
        }
        res[key] = computed(getter.bind(ctx))
      }
      return res
    }
    function resolveWatch(watchOptions, ctx) {
      const res = {}
      for (const key in watchOptions) {
        res[key] = watch(resolveWatchGetter(key, ctx), watchOptions[key].bind(ctx))
      }
      return res
    }
    function resolveWatchGetter(key, ctx) {
      let res
      if (key in ctx['computed']) {
        /* 如果返回的是一个函数,并且返回值是一个对象,那改变对象里的值时不会触发
      watch,要实现深监听(传入函数时,传入对象时不需要,因为默认就是深监听) */
        res = () => ctx[key].value
      } else {
        res = () => ctx[key]
      }
      return res
    }

    function patchComponent(n1, n2, container, anchor) {
      const instance = (n2.component = n1.component)
      const { props, attrs } = instance /* 在组件里定义的props */
      if (n1.props && hasPropsChanged(n1.props, n2.props)) {
        // 有props改变了,需要更新props
        const [nextProps] = resolveProps(n2.type.props, n2.props)
        for (const k in nextProps) {
          // 更新props
          props[k] = nextProps[k]
        }
        for (const k in props) {
          if (!(k in nextProps)) {
            // 如果有prop不存在于新的props那就删除掉这个prop(预设的,在组件里定义的)
            delete props[k]
          }
        }
      }
      if (n1.attrs && hasPropsChanged(n1.attrs, n2.attrs)) {
        // 有attrs改变了,需要更新attrs
        const [_, nextAttrs] = resolveProps(n2.type.attrs, n2.attrs)
        for (const k in nextAttrs) {
          // 更新attrs
          attrs[k] = nextAttrs[k]
        }
        for (const k in attrs) {
          if (!(k in nextAttrs)) {
            // 如果有attr不存在于新的attrs那就删除掉这个attr
            delete attrs[k]
          }
        }
      }
    }

    function resolveProps(options, propsData) {
      const props = {}
      const attrs = {}
      options = options || {}
      propsData = propsData || {}
      // 为组件身上定义的props赋值
      for (const key in propsData) {
        if (key in options || key.startsWith('on')) {
          props[key] = propsData[key]
        } else {
          attrs[key] = propsData[key]
        }
      }
      // 使用默认值
      for (const key in options) {
        if (!(key in propsData || {})) {
          // 在组件里定义了但是父组件没有传入(在组件身上为props赋值)
          props[key] = options[key].default || null
        }
      }
      return [props, attrs]
    }

    function hasPropsChanged(prevProps, nextProps) {
      const nextKeys = Object.keys(nextProps)
      if (nextKeys.length !== Object.keys(prevProps).length) {
        return true
      }
      for (let i = 0; i < nextKeys.length; i++) {
        const key = nextKeys[i]
        if (prevProps[key] !== nextKeys[key]) {
          return true
        }
      }
      return false
    }
    let key = 1
    function h(type, props = null, children = null) {
      const res = {}
      res['type'] = type
      res['key'] = 1
      res['props'] = null
      res['children'] = null
      if (arguments.length === 2) {
        // 说明最后一个参数可能是prop或者children
        if (typeof props === 'object' && !Array.isArray(props)) {
          // 是对象而且不是数组,说明是props
          res['props'] = props
        } else if (typeof props === 'string' || Array.isArray(props)) {
          // 说明第二个参数是子节点
          res['children'] = props
        }
      } else if (arguments.length === 3) {
        res['props'] = props
        res['children'] = children
      }
      return {
        ...res /* 如果有props和children就会覆盖掉默认的null */,
      }
    }
    return {
      render,
      h,
      onMounted,
      onUnmounted,
      defineAsyncComponent,
      KeepAlive,
      Teleport,
      Transition,
    }
  }

  const {
    render,
    h,
    onMounted,
    onUnmounted,
    defineAsyncComponent,
    KeepAlive,
    Teleport,
    Transition,
  } = createRenderer({
    createElement: (tag) => {
      return document.createElement(tag)
    },
    setElementText: (el, text) => {
      el.textContent = text
    },
    createText: (text) => {
      return document.createTextNode(text)
    },
    createComment: (comment) => {
      return document.createComment(comment)
    },
    setText: (el, text) => {
      el.nodeValue = text
    },
    /* 终于知道为什么需要anchor了,因为需要在不需要移动的元素后面插入需要移动的元素
  (而anchor就是不需要移动的元素的下一个节点)(简单diff算法,1号天才的算法) */
    async insert(parent, el, anchor = null) {
      // 如果引用节点(anchor)为 null，则将指定的节点添加到指定父节点(parent)的子节点列表的末尾。
      parent.insertBefore(el, anchor)
    },
    removeDom(parent, el) {
      parent.removeChild(el)
    },
    patchProps(el, key, prevValue, nextValue) {
      // 有些属性在某些元素上是只读的
      function shouldSetAsProps(el, key, value) {
        if (key === 'form' && el.tagName === 'INPUT') return false
        return key in el
      }
      if (/^on/.test(key)) {
        // 事件绑定
        const eName = key.slice(2).toLowerCase()
        //因为el.vel可能不存在,所以不能写成这样：el.vel[eName]
        // invokers是一个元素绑定的所有事件
        const invokers = el.vel || (el.vel = {})
        let invoker = invokers[eName]
        if (nextValue) {
          // 需要绑定事件
          if (!invoker) {
            // 第一次绑定事件
            invoker = invokers[eName] = function (e) {
              if (e.timeStamp < invoker.attached) {
                // *防止事件冒泡导致父元素事件错误触发,当事件进行冒泡到父元素时,父
                // 元素接收到的事件对象是子元素的事件对象,所以各种属性都是子元素
                // 的,所以我们可以根据子元素的timeStamp属性来判断父元素执行时是否
                // 还没有绑定事件(在绑定事件时会将当前时间戳(高精时间)记录下来,然
                // 后与子元素事件发生时的时间作对比)
                // !还是基础不牢!,补红宝书,补犀牛书,补JavaScript基础
                return
              }
              // 传递的事件可以是数组，需要遍历执行
              if (Array.isArray(invoker.value)) {
                invoker.value.forEach((fn) => fn(e))
              } else {
                invoker.value(e)
              }
            }
            invoker.attached = performance.now() // 记录绑定时间
            invoker.value = nextValue
            el.addEventListener(eName, invoker)
          } else {
            // 已经绑定过事件，需要更新invoker的value
            invoker.value = nextValue
          }
        } else {
          // 解绑事件
          el.removeEventListener(eName, invoker)
        }
      } else if (key === 'class') {
        // 类名绑定
        el.className = normalizeClass(nextValue)
      } else if (key === 'style') {
        el.style = normalizeStyle(nextValue)
      } else if (shouldSetAsProps(el, key, nextValue)) {
        // 属性设置
        // 如果key是DOM Properties属性
        const type = typeof el[key]
        if (type === 'boolean' && nextValue === '') {
          // 修正 el["disabled"] = "" 浏览器会将其设置为false的情况,实际上我们希望为true
          el[key] = true
        } else {
          el[key] = nextValue
        }
      } else {
        el.setAttribute(key, nextValue)
      }
    },
  })

  // render(null, document.getElementById('app'))

  // tools
  function normalizeClass(value) {
    if (!value) {
      return ''
    }
    let res = ''
    function handleStringClassName(value) {
      return value.trim()
    }
    function handleObjClassName(value) {
      let res = ''
      for (let key in value) {
        if (value[key]) {
          res += key + ' '
        }
      }
      return res
    }
    function handleArrClassName(value, _res = '') {
      let res = ''
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'string') {
          res += handleStringClassName(value[i]) + ' '
        }
        if (Array.isArray(value[i])) {
          res += handleArrClassName(value[i], res)
        } else if (typeof value[i] === 'object') {
          res += handleObjClassName(value[i])
        }
      }
      return res
    }
    if (typeof value === 'string') {
      res += handleStringClassName(value)
    } else if (Array.isArray(value)) {
      res += handleArrClassName(value)
    } else if (typeof value === 'object') {
      res += handleObjClassName(value)
    }
    return res.trim()
  }

  function normalizeStyle(value) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return '' // 非对象或数组类型直接返回空字符串
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

  /* 求出最长递增子序列,并对应到sources的索引 */
  function getSequence(arr) {
    const p = arr.splice()
    const result = [0]
    let i, j, u, v, c
    const len = arr.length
    for (i = 0; i < len; i++) {
      const arrI = arr[i]
      if (arrI !== 0) {
        j = result[result.length - 1]
        if (arr[j] < arrI) {
          p[i] = j
          result.push(i)
          continue
        }
        u = 0
        v = result.length - 1
        while (u < v) {
          c = ((u + v) / 2) | 0
          if (arr[result[c]] < arrI) {
            u = c + 1
          } else {
            v = c
          }
        }
        if (arrI < arr[result[u]]) {
          if (u > 0) {
            p[i] = result[u - i]
          }
          result[u] = i
        }
      }
    }
    u = result.length
    v = result[u - 1]
    while (u-- > 0) {
      result[u] = v
      v = p[v]
    }
    return result
  }

  function useQueueJob() {
    const queue = new Set()
    const p = Promise.resolve()
    let isFlash = false
    function queueJob(
      job /* 传来要添加到微队列里的函数,这里是在data数据发生改变后将要执行的副作用函数 */
    ) {
      queue.add(job)
      if (!isFlash) {
        isFlash = true
        p.then(() => {
          try {
            queue.forEach((job) => {
              job()
            })
          } finally {
            isFlash = false
            queue.clear = 0
          }
        })
      }
    }
    return queueJob
  }

  exports.Text = Text
  exports.Comment = Comment
  exports.Fragment = Fragment
  exports.render = render
  exports.h = h
  exports.onMounted = onMounted
  exports.onUnmounted = onUnmounted
  exports.defineAsyncComponent = defineAsyncComponent
  exports.KeepAlive = KeepAlive
  exports.Teleport = Teleport
  exports.Transition = Transition
  return exports
})({})
