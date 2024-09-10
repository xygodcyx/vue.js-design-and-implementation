const State = {
  INITIAL: 'INITIAL', //1
  TAG_OPEN: 'TAG_OPEN', //2
  TAG_NAME: 'TAG_NAME', //3
  TEXT: 'TEXT', //4
  TAG_END: 'TAG_END', //5
  TAG_END_NAME: 'TAG_END_NAME', //6
}

const TOKEN_TYPE = {
  TAG: 'TAG',
  TAG_END: 'TAG_END',
  TEXT: 'TEXT',
}

const AST_TYPE = {
  ROOT: 'ROOT',
  ELEMENT: 'ELEMENT',
  TEXT: 'TEXT',
}

const notText = ['<', '>', '/']

function isAlpha(char) {
  return !notText.includes(char)
}

function tokenize(str) {
  let currentState = State.INITIAL
  const chars = []
  const tokens = []
  while (str) {
    const char = str[0] // 只读取
    switch (currentState) {
      case State.INITIAL: {
        if (char === '<') {
          // 开始字符
          currentState = State.TAG_OPEN
          str = str.slice(1)
        } else if (isAlpha(char)) {
          // 如果遇到了字母
          currentState = State.TEXT
          // 将当前字母缓存到chars中
          chars.push(char)
          str = str.slice(1)
        }
        break
      }
      case State.TAG_OPEN: {
        if (isAlpha(char)) {
          // 遇到了字母,进入标签开始名
          currentState = State.TAG_NAME
          chars.push(char)
          str = str.slice(1)
        } else if (char === '/') {
          // 遇到字符/,切换标签结束状态 <p>Vue</p>
          currentState = State.TAG_END
          str = str.slice(1)
        }
        break
      }
      case State.TAG_NAME: {
        if (isAlpha(char)) {
          // 在标签开始名状态下遇到了字母,说明正在读取标签名,不需要切换状态
          chars.push(char)
          str = str.slice(1)
        } else if (char === '>') {
          // 遇到字符>说明开始标签结束,再切换到初始状态
          currentState = State.INITIAL
          tokens.push({
            type: TOKEN_TYPE.TAG,
            name: chars.join(''),
          })
          chars.length = 0
          str = str.slice(1)
        }
        break
      }
      case State.TEXT: {
        if (isAlpha(char)) {
          chars.push(char)
          str = str.slice(1)
        } else if (char === '<') {
          currentState = State.TAG_OPEN
          tokens.push({
            type: TOKEN_TYPE.TEXT,
            content: chars.join(''),
          })
          chars.length = 0
          str = str.slice(1)
        }
        break
      }
      case State.TAG_END: {
        if (isAlpha(char)) {
          // <p>Vue</p>
          // 在结束标签遇到了字母,切换到结束标签名字状态
          currentState = State.TAG_END_NAME
          chars.push(char)
          str = str.slice(1)
        }
        break
      }
      case State.TAG_END_NAME: {
        if (isAlpha(char)) {
          // 还是字母,说明结束标签名字还没读取完,继续读取
          chars.push(char)
          str = str.slice(1)
        } else if (char === '>') {
          // 遇到了字符>
          // <p>Vue</p>
          // 说明这个标签被读取完毕了
          currentState = State.INITIAL
          tokens.push({
            type: TOKEN_TYPE.TAG_END,
            name: chars.join(''),
          })
          chars.length = 0
          str = str.slice(1)
        }
        break
      }
    }
  }
  return tokens
}

function parse(str) {
  const tokens = tokenize(str)
  const root = { type: AST_TYPE.ROOT, children: [] }
  const elementStack = [root]
  while (tokens.length > 0) {
    const token = tokens[0]
    switch (token.type) {
      case TOKEN_TYPE.TAG: {
        const parentRoot = elementStack[elementStack.length - 1]
        const ast = {
          type: AST_TYPE.ELEMENT,
          tag: token.name,
          children: [],
        }
        if (parentRoot) {
          parentRoot.children.push(ast)
        }
        elementStack.push(ast)
        break
      }
      case TOKEN_TYPE.TEXT: {
        const parentRoot = elementStack[elementStack.length - 1]
        const ast = {
          type: AST_TYPE.TEXT,
          content: token.content,
        }
        if (parentRoot) {
          parentRoot.children.push(ast)
        }
        break
      }
      case TOKEN_TYPE.TAG_END: {
        elementStack.pop()
        break
      }
    }
    tokens.shift()
  }
  return root
}

function traverseNode(ast, context) {
  const currentNode = ast
  const children = currentNode.children
  const transforms = context.nodeTransforms /* transforms是与node的type对应的函数描述map */
  if (currentNode.type !== AST_TYPE.ROOT) {
    transforms[currentNode.type](currentNode, context)
  }
  if (children) {
    children.forEach((c) => traverseNode(c, context))
  }
}
function transform(ast) {
  // 这个上下文中的数据会在所有的转换节点之间共享
  const context = {
    // 当前正在转换的节点
    currentNode: null,
    // 当前节点在父节点中的索引位置
    childIndex: 0,
    // 当前节点的父节点
    parent: null,
    nodeTransforms: {
      [AST_TYPE.ELEMENT]: transformElement,
      [AST_TYPE.TEXT]: transformText,
    },
  }
  traverseNode(ast, context)
  dump(ast)
}

function transformElement(node) {
  node.tag = 'h1'
}
function transformText(node) {
  node.content = node.content.repeat(2)
}

function dump(node, indent = 0) {
  const type = node.type
  const desc = type === AST_TYPE.ROOT ? '' : type === AST_TYPE.ELEMENT ? node.tag : node.content
  console.log(`${'-'.repeat(indent)}${type}:${desc}`)
  if (node.children) {
    node.children.forEach((c) => dump(c, indent + 2))
  }
}
