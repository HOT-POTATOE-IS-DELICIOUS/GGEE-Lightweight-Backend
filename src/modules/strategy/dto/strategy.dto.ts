import { IsNotEmpty } from 'class-validator';

/** Request/response DTOs for /strategy. All wire fields are snake_case. */

export class CreateRoomRequestDto {
  @IsNotEmpty({ message: '메시지를 입력해주세요.' })
  message!: string;
}

export class ChatMessageRequestDto {
  @IsNotEmpty()
  message!: string;
}

export interface RoomResponse {
  room_id: string;
  title: string;
  last_chatted_at: Date;
  created_at: Date;
}

export interface MessageResponse {
  message_id: string;
  role: string;
  content: string;
  intent: string | null;
  refined_query: string | null;
  meta_json: string | null;
  created_at: Date;
}
