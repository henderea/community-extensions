module.exports = {
    'env': {
        'es2021': true,
        'node': true
    },
    'extends': [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    'parser': '@typescript-eslint/parser',
    'parserOptions': {
        'ecmaVersion': 12,
        'sourceType': 'module'
    },
    'plugins': [
        '@spence1115/modules-newlines',
        '@typescript-eslint'
    ],
    'rules': {
        '@typescript-eslint/indent': [
            'error',
            4
        ],
        'linebreak-style': [
            'error',
            'unix'
        ],
        'quotes': [
            'error',
            'single'
        ],
        'semi': [
            'error',
            'never'
        ],
        'comma-dangle': 'off',
        '@typescript-eslint/comma-dangle': 'error',
        'prefer-arrow-callback': 'error',
        '@spence1115/modules-newlines/import-declaration-newline': 'error',
        '@spence1115/modules-newlines/export-declaration-newline': 'error',
        '@typescript-eslint/no-explicit-any': 0,
        '@typescript-eslint/no-non-null-assertion': 0
    }
}
