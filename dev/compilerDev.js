const minCompiler = (function (exports) {
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
  const JS_AST_TYPE = {
    FunctionDecl: 'FunctionDecl',
    Identifier: 'Identifier',
    RenturnStatement: 'RenturnStatement',
    CallExpression: 'CallExpression',
    StringLiteral: 'StringLiteral',
    ArrayExpression: 'ArrayExpression',
  }

  const notText = ['<', '>', '/']
  // tool
  function dump(node, indent = 0) {
    const type = node.type
    const desc = type === AST_TYPE.ROOT ? '' : type === AST_TYPE.ELEMENT ? node.tag : node.content
    console.log(`${'  '.repeat(indent)}${type}:${desc}`)
    if (node.children) {
      node.children.forEach((c) => dump(c, indent + 2))
    }
  }

  function isAlpha(char) {
    return !notText.includes(char)
  }
  // tokenize

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
  // parse(把词法分析的结果转换为模板AST)

  function parser(str) {
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

  // transform(把模板AST转换为JsAST) 也就是把描述模板的AST转换成描述JavaScript的AST
  function transform(ast) {
    // 这个上下文中的数据会在所有的转换节点之间共享
    const context = {
      // 当前正在转换的节点
      currentNode: null,
      // 当前节点在父节点中的索引位置
      childIndex: 0,
      // 当前节点的父节点
      parent: null,
      // 替换当前节点
      replaceNode(newNode) {
        context.parent.children[this.childIndex] = newNode
        context.currentNode = newNode
      },
      // 移除当前节点
      removeNode() {
        context.parent.children.splice(context.childIndex, 1)
        context.currentNode = null
      },
      nodeTransforms: [transformRoot, transformElement, transformText],
    }
    traverseNode(ast, context)
    return ast.jsNode
  }

  function traverseNode(ast, context) {
    context.currentNode = ast
    const exitFns = [] /* 先进后出(后进先出,),确保在执行退出函数时,其所有的子节点都已经转换完毕了 */
    const transforms = context.nodeTransforms /* transforms是与node的type对应的函数描述map */
    for (let i = 0; i < transforms.length; i++) {
      const onExit = transforms[i](context.currentNode, context)
      if (onExit) {
        exitFns.push(onExit)
      }
      if (context.currentNode === null) {
        return
      }
    }
    const children = context.currentNode.children
    if (children) {
      for (let i = 0; i < children.length; i++) {
        context.parent = context.currentNode
        context.childIndex = i
        traverseNode(children[i], context)
      }
    }
    // 执行退出函数
    let i = exitFns.length
    while (i--) {
      exitFns[i]()
    }
  }

  function transformRoot(node, context) {
    return () => {
      if (node.type !== AST_TYPE.ROOT) {
        return
      }
      // 根节点的第一个子节点就是模板的根节点(暂时不考虑多个子节点的情况)
      const vnodeJsAST = node.children[0].jsNode /* 拿到jsNode,这个jsNode就是Js的AST */
      node.jsNode = {
        type: JS_AST_TYPE.FunctionDecl,
        id: createIdentifier('render'),
        params: [],
        body: [createReturnStatement(vnodeJsAST)],
      }
    }
  }

  function transformElement(node, context) {
    return () => {
      // 可能有children的节点要在onExit里转换,因为可以确保其子节点已经转换完毕
      if (node.type !== AST_TYPE.ELEMENT) {
        return
      }
      const callExp = createCallExpression('h', [createStringLiteral(node.tag)])
      node.children.length === 1
        ? callExp.arguments.push(node.children[0].jsNode)
        : callExp.arguments.push(createArrayExpression(node.children.map((c) => c.jsNode)))
      node.jsNode = callExp
    }
  }

  function transformText(node, context) {
    if (node.type !== AST_TYPE.TEXT) {
      return
    }
    // 构造JavaScriptAST节点,在原来的模板AST的基础上进行转换,最后会生成js可执行的和渲染器相匹配的render函数
    return () => {
      node.jsNode = createStringLiteral(node.content)
    }
  }

  function createStringLiteral(content) {
    return {
      type: JS_AST_TYPE.StringLiteral,
      content,
    }
  }

  function createIdentifier(name) {
    return {
      type: JS_AST_TYPE.Identifier,
      name,
    }
  }

  function createArrayExpression(elements) {
    return {
      type: JS_AST_TYPE.ArrayExpression,
      elements,
    }
  }
  function createCallExpression(callee, arguments) {
    return {
      type: JS_AST_TYPE.CallExpression,
      callee: createIdentifier(callee),
      arguments,
    }
  }
  function createReturnStatement(returnContent) {
    return {
      type: JS_AST_TYPE.RenturnStatement,
      return: returnContent,
    }
  }

  // generate code(把JsAST转换为Js可执行的代码)
  function generate(jsNode) {
    const context = {
      code: '',
      currentIndent: 0,
      newLine() {
        context.code += '\n' + `  `.repeat(context.currentIndent)
      },
      push(code) {
        context.code += code
      },
      indent() {
        context.currentIndent++
        context.newLine()
      },
      indentLine() {
        context.newLine()
      },
      deIndent() {
        context.currentIndent--
        context.newLine()
      },
    }
    genNode(jsNode, context)
    return context.code
  }
  function genNode(node, context) {
    switch (node.type) {
      case JS_AST_TYPE.FunctionDecl: {
        genFunctionDecl(node, context)
        break
      }
      case JS_AST_TYPE.RenturnStatement: {
        genReturnStatement(node, context)
        break
      }
      case JS_AST_TYPE.CallExpression: {
        genCallExpression(node, context)
        break
      }
      case JS_AST_TYPE.StringLiteral: {
        genStringLiteral(node, context)
        break
      }
      case JS_AST_TYPE.ArrayExpression: {
        genArrayExpression(node, context)
        break
      }
    }
  }
  function genFunctionDecl(node, context) {
    const { push, indent, deIndent, indentLine } = context
    push(`function ${node.id.name}`)
    push(`(`)
    genNodeList(node.params, context)
    push(`)`)
    push(`{`)
    indent()
    node.body.forEach((n, i) => {
      genNode(n, context)
      if (i < node.body.length - 1) {
        indentLine()
      }
    })
    deIndent()
    push(`}`)
  }
  function genNodeList(nodes, context) {
    const { push } = context
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      genNode(node, context)
      if (i < nodes.length - 1) {
        push(`,`)
      }
    }
  }
  function genReturnStatement(node, context) {
    const { push } = context
    push(`return `)
    genNode(node.return, context)
  }
  function genCallExpression(node, context) {
    const { push } = context
    const { callee, arguments: args } = node
    push(`${callee.name}(`)
    genNodeList(args, context)
    push(`)`)
  }
  function genStringLiteral(node, context) {
    const { push } = context
    push(`'${node.content}'`) /* 注意,生成文字的时候要加一对引号''因为这是生成的代码 */
  }
  function genArrayExpression(node, context) {
    const { push } = context
    push(`[`)
    genNodeList(node.elements, context)
    push(`]`)
  }
  // compile
  function compile(str) {
    const ast = parser(str)
    dump(ast)
    const jsAst = transform(ast)
    return generate(jsAst)
  }
  exports.compile = compile
  return exports
})({})
