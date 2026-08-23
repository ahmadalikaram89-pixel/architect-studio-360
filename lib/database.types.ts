// أنواع TypeScript مولَّدة تلقائياً من مخطط قاعدة بيانات Supabase الحية (عبر
// generate_typescript_types) — ما تتعدّل يدوياً، تُعاد بولّدتها من قاعدة البيانات مباشرة
// لو تغيّر supabase-schema.sql. مصدر الحقيقة الحقيقي هو القاعدة الحية نفسها، مو تخمين.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      furniture: {
        Row: {
          created_at: string
          id: string
          kind: string
          room_id: string
          rotation: number
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          room_id: string
          rotation?: number
          x: number
          y: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          room_id?: string
          rotation?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "furniture_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      openings: {
        Row: {
          created_at: string
          edge_index: number | null
          id: string
          kind: string
          position: number
          room_id: string
          wall: string | null
        }
        Insert: {
          created_at?: string
          edge_index?: number | null
          id?: string
          kind: string
          position: number
          room_id: string
          wall?: string | null
        }
        Update: {
          created_at?: string
          edge_index?: number | null
          id?: string
          kind?: string
          position?: number
          room_id?: string
          wall?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "openings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          links_to_design: boolean
          notes: string | null
          owner: string | null
          phase_key: number
          project_id: string
          start_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          links_to_design?: boolean
          notes?: string | null
          owner?: string | null
          phase_key: number
          project_id: string
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          links_to_design?: boolean
          notes?: string | null
          owner?: string | null
          phase_key?: number
          project_id?: string
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          invited_email: string
          project_id: string
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email: string
          project_id: string
          role?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string
          project_id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          city: string | null
          client: string | null
          created_at: string
          depth: number
          id: string
          land_type: string | null
          name: string
          updated_at: string
          user_id: string
          wall_color: string
          wall_height: number
          wall_material: string
          width: number
        }
        Insert: {
          city?: string | null
          client?: string | null
          created_at?: string
          depth?: number
          id?: string
          land_type?: string | null
          name: string
          updated_at?: string
          user_id?: string
          wall_color?: string
          wall_height?: number
          wall_material?: string
          width?: number
        }
        Update: {
          city?: string | null
          client?: string | null
          created_at?: string
          depth?: number
          id?: string
          land_type?: string | null
          name?: string
          updated_at?: string
          user_id?: string
          wall_color?: string
          wall_height?: number
          wall_material?: string
          width?: number
        }
        Relationships: []
      }
      rooms: {
        Row: {
          color: string
          created_at: string
          floor: number
          floor_material: string
          gh: number
          gw: number
          gx: number
          gy: number
          has_roof: boolean
          id: string
          name: string
          points: Json | null
          project_id: string
          roof_type: string
          wall_color: string | null
          wall_height: number | null
          wall_material: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          floor?: number
          floor_material?: string
          gh: number
          gw: number
          gx: number
          gy: number
          has_roof?: boolean
          id?: string
          name: string
          points?: Json | null
          project_id: string
          roof_type?: string
          wall_color?: string | null
          wall_height?: number | null
          wall_material?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          floor?: number
          floor_material?: string
          gh?: number
          gw?: number
          gx?: number
          gy?: number
          has_roof?: boolean
          id?: string
          name?: string
          points?: Json | null
          project_id?: string
          roof_type?: string
          wall_color?: string | null
          wall_height?: number | null
          wall_material?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stairs: {
        Row: {
          created_at: string
          floor: number
          id: string
          project_id: string
          rotation: number
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          floor?: number
          id?: string
          project_id: string
          rotation?: number
          x: number
          y: number
        }
        Update: {
          created_at?: string
          floor?: number
          id?: string
          project_id?: string
          rotation?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "stairs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      subtasks: {
        Row: {
          created_at: string
          done: boolean
          id: string
          phase_id: string
          sort_order: number
          text: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          id?: string
          phase_id: string
          sort_order?: number
          text: string
        }
        Update: {
          created_at?: string
          done?: boolean
          id?: string
          phase_id?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      default_window_positions: {
        Args: { wall_length: number }
        Returns: number[]
      }
      has_phase_read_access: {
        Args: { target_phase_id: string }
        Returns: boolean
      }
      has_phase_write_access: {
        Args: { target_phase_id: string }
        Returns: boolean
      }
      has_project_read_access: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      has_project_write_access: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      has_room_read_access: {
        Args: { target_room_id: string }
        Returns: boolean
      }
      has_room_write_access: {
        Args: { target_room_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
