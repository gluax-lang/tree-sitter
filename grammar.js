const PREC = {
  else: 4,
  or: 1,
  and: 3,
  compare: 5,
  bitor: 9,
  bitxor: 11,
  bitand: 13,
  shift: 15,
  concat: 18,
  add: 19,
  mul: 21,
  pow: 31,
  unary: 27,
  postfix: 40,
};

// Shared expression alternatives. `_expression` adds class_init on top;
// `_condition_expr` omits it (matches ExprCtx::Condition in the parser).
function exprChoices($) {
  return [
    $.number,
    $.string,
    $.bool,
    $.nil,
    $.vararg,
    $.path,
    $.paren_expression,
    $.tuple_expression,
    $.unary_expression,
    $.binary_expression,
    $.call_expression,
    $.method_call_expression,
    $.field_expression,
    $.index_expression,
    $.unwrap_expression,
    $.if_expression,
    $.while_expression,
    $.loop_expression,
    $.for_expression,
    $.func_expression,
    $.break_expression,
    $.continue_expression,
    $.throw_expression,
    $.match_expression,
    $.type_match_expression,
    $.vec_init,
    $.map_init,
    $.cast_expression,
    $.super_path,
    $.block,
  ];
}

module.exports = grammar({
  name: 'gluax',

  extras: $ => [/\s/, $.line_comment, $.block_comment],

  word: $ => $.identifier,

  conflicts: $ => [
    [$._expression, $.class_init],
    [$._condition_expr, $.class_init],
  ],

  rules: {
    source_file: $ => repeat($._item),

    // ---------- Comments ----------
    line_comment: $ => token(seq('//', /.*/)),
    block_comment: $ => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/')),

    // ---------- Attributes ----------
    attributes: $ => repeat1($.attribute),
    attribute: $ => seq(
      '#', '[',
      field('key', $.identifier),
      optional(choice(
        $.attr_list,
        seq('=', field('value', $.string)),
      )),
      ']',
    ),
    attr_list: $ => seq(
      '(',
      commaSep($.meta_item),
      ')',
    ),
    meta_item: $ => choice(
      seq(field('key', $.identifier), '=', field('value', $.string)),
      field('word', $.identifier),
    ),

    // ---------- Items ----------
    _item: $ => choice(
      $.func_item,
      $.class_item,
      $.impl_item,
      $.let_item,
      $.import_item,
      $.use_item,
      $.cfg_item,
    ),

    func_item: $ => seq(
      optional($.attributes),
      optional('pub'),
      'func',
      field('name', $.identifier),
      $._func_def,
    ),

    // shared func def: params, optional `!`, returns, body-or-`;`
    _func_def: $ => seq(
      field('params', $.param_list),
      optional(field('errorable', '!')),
      optional(field('returns', $.return_types)),
      choice(field('body', $.block), ';'),
    ),

    param_list: $ => seq(
      '(',
      optional(seq('self', optional(','))),
      commaSep($.param),
      ')',
    ),
    param: $ => choice(
      seq(field('name', $.identifier), ':', field('type', $._type)),
      field('type', $._type),
    ),

    return_types: $ => seq('->', $._type),

    class_item: $ => seq(
      optional($.attributes),
      optional('pub'),
      'class',
      field('name', $.identifier),
      optional(seq(':', field('super', $._type))),
      $.class_body,
    ),
    class_body: $ => seq(
      '{',
      repeat($._class_member),
      '}',
    ),
    _class_member: $ => choice($.class_field, $.class_func),
    class_field: $ => seq(
      optional($.attributes),
      optional('pub'),
      field('name', $.identifier),
      ':',
      field('type', $._type),
      optional(','),
    ),
    class_func: $ => seq(
      optional($.attributes),
      'func',
      field('name', $.identifier),
      $._func_def,
    ),

    impl_item: $ => seq(
      'impl',
      field('class', $._type),
      '{',
      repeat($.impl_method),
      '}',
    ),
    impl_method: $ => seq(
      optional($.attributes),
      optional('pub'),
      'func',
      field('name', $.identifier),
      $._func_def,
    ),

    let_item: $ => seq(
      optional($.attributes),
      optional('pub'),
      choice('let', 'const'),
      commaSep1($._let_binding),
      choice(
        ';',                                    // extern
        seq('=', commaSep1($._expression), ';'),
      ),
    ),
    _let_binding: $ => seq(
      field('name', $._binding_name),
      seq(':', field('type', $._type)),        // items require a type
    ),

    import_item: $ => seq(
      optional('pub'),
      'import',
      field('path', $.string),
      optional(seq('as', $._binding_name)),
      ';',
    ),

    use_item: $ => seq(
      optional('pub'),
      'use',
      $._use_tree,
      ';',
    ),
    _use_tree: $ => seq(
      $.path,
      optional(choice(
        seq('::', '*'),
        seq('::', $.use_group),
        seq('as', $.identifier),
      )),
    ),
    use_group: $ => seq(
      '{',
      commaSep($._use_group_item),
      '}',
    ),
    _use_group_item: $ => choice('*', $.path),

    // ---------- cfg / feature blocks ----------
    cfg_item: $ => seq(
      $._cond_head,
      field('then', $.cfg_item_body),
      optional(seq('else', field('else', $.cfg_item_body))),
    ),
    cfg_item_body: $ => seq('{', repeat($._item), '}'),

    cfg_stmt: $ => seq(
      $._cond_head,
      field('then', $.block),
      optional(seq('else', field('else', $.block))),
    ),

    _cond_head: $ => seq(
      '@',
      field('kind', choice('cfg', 'feature')),
      $._cond,
    ),
    _cond: $ => $._cond_or,
    _cond_or: $ => choice(
      prec.left(1, seq($._cond_or, '||', $._cond_and)),
      $._cond_and,
    ),
    _cond_and: $ => choice(
      prec.left(2, seq($._cond_and, '&&', $._cond_unary)),
      $._cond_unary,
    ),
    _cond_unary: $ => choice(
      seq('!', $._cond_unary),
      seq('(', $._cond, ')'),
      $.cond_atom,
    ),
    cond_atom: $ => $.string,

    // ---------- Statements ----------
    block: $ => seq('{', repeat($._statement), '}'),
    _statement: $ => choice(
      $.let_stmt,
      $.return_stmt,
      $.assign_stmt,
      $.cfg_stmt,
      $.expression_statement,
    ),

    let_stmt: $ => seq(
      choice('let', 'const'),
      commaSep1(seq(
        field('name', $._binding_name),
        optional(seq(':', field('type', $._type))),
      )),
      '=',
      commaSep1($._expression),
      ';',
    ),

    return_stmt: $ => seq(
      'return',
      optional(commaSep1($._expression)),
      ';',
    ),

    assign_stmt: $ => seq(
      commaSep1($._assign_target),
      '=',
      commaSep1($._expression),
      ';',
    ),
    _assign_target: $ => choice(
      $.path,
      $.field_expression,
      $.index_expression,
    ),

    expression_statement: $ => seq($._expression, optional(';')),

    // ---------- Expressions ----------
    _expression: $ => choice($.class_init, ...exprChoices($)),
    _condition_expr: $ => choice(...exprChoices($)),

    unary_expression: $ => prec(PREC.unary, seq(
      field('op', choice('-', '!', '~', '#')),
      field('operand', $._expression),
    )),

    binary_expression: $ => {
      const table = [
        [PREC.or, '||', 'left'],
        [PREC.and, '&&', 'left'],
        [PREC.compare, choice('==', '!=', '<', '>', '<=', '>='), 'left'],
        [PREC.else, 'else', 'right'],
        [PREC.bitor, '|', 'left'],
        [PREC.bitxor, '~', 'left'],
        [PREC.bitand, '&', 'left'],
        [PREC.shift, choice('<<', '>>'), 'left'],
        [PREC.concat, '..', 'right'],
        [PREC.add, choice('+', '-'), 'left'],
        [PREC.mul, choice('*', '/', '%'), 'left'],
        [PREC.pow, '**', 'right'],
      ];
      return choice(...table.map(([p, op, assoc]) => {
        const rule = seq(
          field('left', $._expression),
          field('op', op),
          field('right', $._expression),
        );
        return assoc === 'left' ? prec.left(p, rule) : prec.right(p, rule);
      }));
    },

    call_expression: $ => prec.right(PREC.postfix, seq(
      field('function', $._expression),
      field('arguments', $.argument_list),
      optional('!'),
      optional($.catch_clause),
    )),
    method_call_expression: $ => prec.right(PREC.postfix, seq(
      field('receiver', $._expression),
      ':',
      optional(seq(
        field('method', $.identifier),
        optional(field('arguments', $.argument_list)),
      )),
      optional('!'),
      optional($.catch_clause),
    )),
    argument_list: $ => seq('(', commaSep($._expression), ')'),
    catch_clause: $ => seq(
      'catch',
      optional(field('binding', $._binding_name)),
      field('body', $.block),
    ),

    field_expression: $ => prec(PREC.postfix, seq(
      field('object', $._expression),
      '.',
      field('field', $.identifier),
    )),
    index_expression: $ => prec(PREC.postfix, seq(
      field('object', $._expression),
      '[', field('index', $._expression), ']',
    )),
    unwrap_expression: $ => prec(PREC.postfix, seq($._expression, '?')),

    paren_expression: $ => seq('(', $._expression, ')'),
    tuple_expression: $ => seq(
      '(',
      $._expression, ',',
      commaSep($._expression),
      ')',
    ),

    if_expression: $ => prec.right(seq(
      'if',
      field('condition', $._condition_expr),
      field('then', $.block),
      repeat(seq('else', 'if', field('condition', $._condition_expr), field('then', $.block))),
      optional(seq('else', field('else', $.block))),
    )),

    while_expression: $ => seq(
      'while',
      optional($._loop_label),
      field('condition', $._condition_expr),
      field('body', $.block),
    ),
    loop_expression: $ => seq(
      'loop',
      optional(seq(':', field('label', $.identifier))),
      field('body', $.block),
    ),
    _loop_label: $ => seq(':', field('label', $.identifier), ';'),

    for_expression: $ => seq(
      'for',
      optional($._loop_label),
      choice($._for_num, $._for_in),
    ),
    _for_num: $ => seq(
      field('var', $._binding_name),
      '=',
      field('start', $._condition_expr),
      ',',
      field('end', $._condition_expr),
      optional(seq(',', field('step', $._condition_expr))),
      field('body', $.block),
    ),
    _for_in: $ => seq(
      commaSep1(field('var', $._binding_name)),
      'in',
      field('iter', $._condition_expr),
      field('body', $.block),
    ),

    func_expression: $ => seq('func', $._func_def),

    break_expression: $ => prec.right(seq('break', optional($.identifier))),
    continue_expression: $ => prec.right(seq('continue', optional($.identifier))),
    throw_expression: $ => seq('throw', $._expression),

    match_expression: $ => seq(
      'match',
      field('value', $._condition_expr),
      '{',
      repeat($.match_arm),
      '}',
    ),
    match_arm: $ => seq(
      field('pattern', $.match_pattern),
      '=>',
      field('body', $._expression),
      optional(','),
    ),
    match_pattern: $ => seq(
      $._single_pattern,
      repeat(seq('|', $._single_pattern)),
    ),
    _single_pattern: $ => choice(
      $.nil, $.number, $.string, $.bool, '_',
    ),

    type_match_expression: $ => seq(
      'typematch',
      field('value', $._condition_expr),
      '{',
      repeat($.type_match_arm),
      '}',
    ),
    type_match_arm: $ => seq(
      optional(seq(field('binding', $._binding_name), ':')),
      field('pattern', choice('_', $._type)),
      '=>',
      field('body', $._expression),
      optional(','),
    ),

    class_init: $ => prec.dynamic(1, seq(
      field('path', $.path),
      '{',
      commaSep($.class_init_field),
      '}',
    )),
    class_init_field: $ => seq(
      field('name', $.identifier),
      ':',
      field('value', $._expression),
    ),

    vec_init: $ => choice(
      seq('vec', optional(seq('::', '<', $._type, '>')), '[', commaSep($._expression), ']'),
      seq('[', commaSep($._expression), ']'),
    ),
    map_init: $ => seq(
      'map',
      optional(seq('::', '<', $._type, optional(seq(',', $._type)), '>')),
      '{',
      commaSep($.map_entry),
      '}',
    ),
    map_entry: $ => seq(
      field('key', $._expression),
      ':',
      field('value', $._expression),
    ),

    cast_expression: $ => seq(
      '@', 'cast', '(',
      field('expr', $._expression), ',',
      field('type', $._type),
      ')',
    ),
    super_path: $ => seq('@', 'super', $.path),

    // ---------- Types ----------
    _type: $ => choice(
      $.optional_type,
      $.func_type,
      $.tuple_type,
      $.vararg_type,
      $.vec_type,
      $.map_type,
      $.union_type,
      $.unreachable_type,
      $.path,
    ),
    optional_type: $ => prec.right(seq('?', $._type)),
    vararg_type: $ => prec.right(seq('...', $._type)),
    unreachable_type: $ => 'unreachable',
    func_type: $ => seq(
      'func',
      $.param_list,
      optional('!'),
      optional($.return_types),
    ),
    tuple_type: $ => seq('(', commaSep($._type), ')'),
    vec_type: $ => choice(
      seq('vec', '<', $._type, '>'),
      seq('[', $._type, ']'),
    ),
    map_type: $ => seq('map', '<', $._type, ',', $._type, '>'),
    union_type: $ => prec.left(1, seq($._type, '|', $._type)),

    // ---------- Paths & atoms ----------
    path: $ => prec.left(seq(
      $.identifier,
      repeat(seq('::', $.identifier)),
    )),

    _binding_name: $ => choice($.identifier, '_'),

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    number: $ => /\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?|0x[0-9a-fA-F_]+/,
    string: $ => choice(
      seq('"', repeat(choice(/[^"\\]/, /\\./)), '"'),
      seq("'", repeat(choice(/[^'\\]/, /\\./)), "'"),
    ),
    bool: $ => choice('true', 'false'),
    nil: $ => 'nil',
    vararg: $ => '...',
  },
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)), optional(','));
}
