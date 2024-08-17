const Text = Symbol() // 描述文本节点
const Comment = Symbol() // 描述注释节点
const Fragment = Symbol() // 描述片段节点
function createRenderer(options) {
  const {
    createElement,
    setElementText,
    insert,
    unmount,
    patchProps,
    createText,
    createComment,
    setText,
  } = options

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
        mountElement(n2, container, anchor)
      } else {
        // 打补丁(更新)
        /* 因为是html节点,所以有属性,所以需要更新props,而别的节点不需要更新props(除了组件) */
        patchElement(n1, n2)
      }
    } else if (type === Text) {
      // 文本节点
      if (!n1) {
        // 如果n1不存在,则需要创建文本节点
        const el = (n2.el = createText(n2.children))
        insert(container, el)
      } else {
        // 如果n1存在,并且n1和n2的children /* 实际内容 */ 不同,则需要更新文本节点
        const el = (n2.el = n1.el)
        if (n1.children !== n2.children) {
          setText(el, n2.children)
        }
      }
    } else if (type === Comment) {
      // 注释节点
      if (!n1) {
        const el = (n2.el = createComment(n2.children))
        insert(container, el)
      } else {
        // 如果n1存在,并且n1和n2的children不同,则需要更新注释节点
        const el = (n2.el = n1.el)
        if (n1.children !== n2.children) {
          setText(el, n2.children)
        }
      }
    } else if (type === Fragment) {
      // fragment节点
      if (!n1) {
        // 如果n1不存在,逐个挂载子节点即可,因为是fragment节点,不需要挂载父节点
        n2.children.forEach((c) => patch(null, c, container))
      } else {
        // 如果n1存在,那么只需要更新fragment节点的children即可(因为fragment节点没有真实节点)
        /* 走patchChildren不会错,因为patchelement里最终会执行patch */
        patchChildren(n1, n2, container)
      }
    } else if (typeof type === 'object') {
      // 组件
    } else if (typeof type === '??') {
      // 其他
    }
  }
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
      // // 不需要每次都从0开始遍历,只需要从上次找到的位置开始就行
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
              const anchor = prevNode.el.nextSibling /* 拿到前一个节点的下一个节点的真实dom */
              // 获取anchor的思想也极其巧妙,如果没有anchor,那么就说明不需要
              // 移动的元素在旧节点树的最后,那就直接插入到最后即可
              // 因为更新的目的就是把当前找到的节点的真实dom插入到新节点的真实dom后面(按新节点的顺序)
              insert(container, el, anchor)
            } else {
              // 如果prevNode不存在,那么说明是第一个节点,那么不需要移动,因为它的第一个,其他的旧节点应该移动到它的后面
            }
            // insert(container, el)
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
    console.time('quickDiff')
    // 更新相同的前置节点(开头相同的节点)
    let j = 0
    let oldVNode = oldChildren[j]
    let newVNode = newChildren[j]
    while (oldVNode.key === newVNode.key) {
      patch(oldVNode, newVNode, container)
      j++
      oldVNode = oldChildren[j]
      newVNode = newChildren[j]
    }
    // 更新相同的后置节点(末尾相同的节点)
    let oldEndIndex = oldChildren.length - 1
    let newEndIndex = newChildren.length - 1
    oldVNode = oldChildren[oldEndIndex]
    newVNode = newChildren[newEndIndex]
    while (oldVNode.key === newVNode.key) {
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
      while (oldEndIndex >= j /* 因为j在++,会有一刻newEndIndex < j  */) {
        unmount(oldChildren[j++])
      }
    } else {
      // 非理性情况
    }
    console.timeEnd('quickDiff')
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
    insert(container, el, anchor) // 挂载节点到父容器(真实dom) (会等到所有子节点都insert完毕了才会insert自己)
  }
  return {
    render,
  }
}
const { render } = createRenderer({
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
  unmount(vnode) {
    _unmount(vnode)
    function _unmount(vnode) {
      if (vnode.type === Fragment) {
        // fragment需要逐个卸载子节点
        vnode.children.forEach((c) => _unmount(c))
        return
      }
      if (Array.isArray(vnode.children)) {
        vnode.children.forEach((c) => _unmount(c))
      }
      const parent = vnode.el.parentNode
      if (parent) {
        parent.removeChild(vnode.el)
      }
    }
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
