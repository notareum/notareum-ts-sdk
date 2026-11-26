export const NotareumConformanceGateABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registry_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "rule",
        "type": "uint8"
      }
    ],
    "name": "ConformanceFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MAX_CLOCK_SKEW",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_METADATA_DEPTH",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_SAFE_INTEGER",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MINT_WINDOW",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "RULESET",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "version",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "type_",
            "type": "string"
          },
          {
            "components": [
              {
                "internalType": "string",
                "name": "name",
                "type": "string"
              },
              {
                "internalType": "uint256",
                "name": "chainId",
                "type": "uint256"
              },
              {
                "internalType": "string",
                "name": "network",
                "type": "string"
              }
            ],
            "internalType": "struct Chain",
            "name": "chain",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "string",
                "name": "identifier",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "name",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "alias_",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "description",
                "type": "string"
              }
            ],
            "internalType": "struct Resource",
            "name": "resource",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "address",
                "name": "account",
                "type": "address"
              },
              {
                "internalType": "string",
                "name": "name",
                "type": "string"
              },
              {
                "internalType": "string",
                "name": "entityType",
                "type": "string"
              }
            ],
            "internalType": "struct Issuer",
            "name": "issuer",
            "type": "tuple"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "supersedes",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "expiresAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct Nota",
        "name": "nota",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "metadata",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "check",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "notaId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "resourceId",
        "type": "bytes32"
      },
      {
        "internalType": "enum ControlProof",
        "name": "controlProof",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "text",
        "type": "bytes"
      }
    ],
    "name": "isDisplayString",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "metadata",
        "type": "bytes"
      }
    ],
    "name": "isStructuredObject",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "registry",
    "outputs": [
      {
        "internalType": "contract INotareumGateRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "text",
        "type": "bytes"
      }
    ],
    "name": "textRule",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "rule",
        "type": "uint8"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  }
] as const;
