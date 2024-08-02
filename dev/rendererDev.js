const Text = Symbol() // 描述文本节点
const Comment = Symbol() // 描述注释节点
const Fragment = Symbol() // 描述片段节点
function createRenderer(options) {
  function render(vnode, container) {
    if (vnode) {
      // 挂载或更新
      patch(container._vnode /* 旧vnode */, vnode /* 新vnode */, container /* 父容器 */)
    } else {
      // 卸载
      if (container._vnode) {
        unmount(container._vnode)
      }
    }
    // 标记container的vnode,此后可以根据container._vnode判断是否存在虚拟节点然后以此判断是需要更新还是卸载
    container._vnode = vnode
  }
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

  // n1旧 n2新
  /**
   * patch第一个参数为null时,意为挂载节点,否则进行更新
   */
  function patch(n1, n2, container) {
    if (n1 && n2 && n1.type !== n2.type) {
      // 类型不同，需要卸载旧节点，然后挂载新节点
      unmount(n1)
      n1 = null
    }
    // 运行到这里,有两种情况:
    // 1. n1和n2都存在且类型相同,需要更新
    // 2. n1不存在,n2存在,需要卸载n1
    const { type } = n2
    if (typeof type === 'string') {
      // 普通html元素
      if (!n1) {
        // 旧的节点不存在，需要挂载新节点
        mountElement(n2, container)
      } else {
        // 打补丁
        patchElement(n1, n2)
      }
    } else if (type === Text) {
      // 文本节点
      if (!n1) {
        // 如果n1不存在,则需要创建文本节点
        const el = (n2.el = createText(n2.children))
        insert(container, el)
      } else {
        // 如果n1存在,并且n1和n2的children不同,则需要更新文本节点
        const el = (n2.el = n1.el)
        if (n1.children !== n2.children) {
          setText(el, n2.children)
        }
      }
    } else if (type === Comment) {
      // 注释节点
      if (!n1) {
        // 如果n1不存在,则需要创建注释节点
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
        // 如果n1存在,并且n1和n2的children不同,那就更新fragment节点
        patchChildren(n1, n2, container)
      }
    } else if (typeof type === 'object') {
      // 组件
    } else if (typeof type === '??') {
      // 其他
    }
  }
  function patchElement(n1, n2) {
    const el = (n2.el = n1.el)
    const oldProps = n1.props
    const newProps = n2.props

    // 更新属性
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
    patchChildren(n1, n2, el)
  }
  /**
  更新子节点时,理论上有九种情况的自由组合
  即:
  新节点为文本节点,旧节点为三种节点之一
  新节点为数组,旧节点为三种节点之一
  新节点为null,旧节点为三种节点之一
  但实际上不需要这么多情况
  */
  function patchChildren(n1, n2, container) {
    const c1 = n1.children
    const c2 = n2.children
    if (typeof c2 === 'string') {
      // 新节点是文本节点
      if (Array.isArray(c1)) {
        // 旧节点是数组,需要先卸载旧节点
        c2.forEach((c) => unmount(c))
      }
      // 然后设置文本节点
      setElementText(container, c2)
    } else if (Array.isArray(c2)) {
      // 新节点是数组
      if (Array.isArray(c1)) {
        // 旧节点也是数组，这里涉及diff算法
        // 现在先简单的实现功能
        // 卸载之前的，然后挂在新的
        c1.forEach((c) => unmount(c))
        c2.forEach((c) => patch(null, c, container))
      } else {
        // 旧节点是文本或null
        // 无论是那种情况,都需要先清空旧节点,然后挂载新节点
        setElementText(container, '')
        c2.forEach((c) => patch(null, c, container))
      }
    } else {
      // 新节点是null,即容器只是一个空标签,里面没有内容,但是存在元素 eg: <div></div>
      if (Array.isArray(c1)) {
        // 旧节点是数组
        // 需要先卸载旧节点
        c1.forEach((c) => unmount(c))
      } else {
        setElementText(container, '')
      }
    }
  }

  function mountElement(vnode, container) {
    // 将vnode的真实节点保存到el中,为了后续的更新和卸载
    const el = (vnode.el = createElement(vnode.type))

    if (typeof vnode.children === 'string') {
      // 子节点是文本
      setElementText(el, vnode.children)
    } else if (Array.isArray(vnode.children)) {
      // 子节点是数组
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
        patchProps(el, key, null, vnode.props[key])
      }
    }
    insert(container, el)
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
  insert(parent, el, anchor = null) {
    parent.appendChild(el)
  },
  unmount(vnode) {
    _unmount(vnode)
    function _unmount(vnode) {
      if (vnode.type === Fragment) {
        // fragment需要逐个卸载子节点
        vnode.children.forEach((c) => _unmount(c))
        return
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
              return // 防止事件冒泡导致父元素事件错误触发
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
