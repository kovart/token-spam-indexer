import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ERC20_APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
export const ERC721_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ERC721_APPROVAL_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
export const ERC721_APPROVAL_FOR_ALL_TOPIC =
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
export const ERC1155_TRANSFER_SINGLE_TOPIC =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
export const ERC1155_TRANSFER_BATCH_TOPIC =
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
export const ERC1155_SET_APPROVAL_FOR_ALL_TOPIC =
  '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';

export const DATA_FOLDER_PATH = path.resolve(__dirname, 'data');
export const RPC_URL = process.env.RPC_URL;