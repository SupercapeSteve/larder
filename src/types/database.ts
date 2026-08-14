/**
 * Database types for the Larder schema.
 *
 * Shape matches `supabase gen types typescript --linked` output so it can be
 * regenerated in place once the Supabase CLI is available:
 *
 *   supabase gen types typescript --linked > src/types/database.ts
 *
 * Kept in lockstep with supabase/migrations/0001_larder_init.sql by hand.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          avatar_emoji: string | null
          avatar_color: string | null
          avatar_url: string | null
          preferences: Json | null
          created_at: string
        }
        Insert: {
          id: string
          display_name: string
          avatar_emoji?: string | null
          avatar_color?: string | null
          avatar_url?: string | null
          preferences?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          avatar_emoji?: string | null
          avatar_color?: string | null
          avatar_url?: string | null
          preferences?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      households: {
        Row: {
          id: string
          name: string
          join_code: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          join_code: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          join_code?: string
          created_by?: string
          created_at?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: string
          joined_at: string
        }
        Insert: {
          household_id: string
          user_id: string
          role?: string
          joined_at?: string
        }
        Update: {
          household_id?: string
          user_id?: string
          role?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      lists: {
        Row: {
          id: string
          household_id: string
          name: string
          is_default: boolean
          created_at: string
        }
        Insert: {
          id?: string
          household_id: string
          name?: string
          is_default?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          household_id?: string
          name?: string
          is_default?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lists_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      items: {
        Row: {
          id: string
          list_id: string
          name: string
          quantity: string | null
          category: string | null
          note: string | null
          checked: boolean
          added_by: string | null
          checked_by: string | null
          checked_at: string | null
          source: string
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          list_id: string
          name: string
          quantity?: string | null
          category?: string | null
          note?: string | null
          checked?: boolean
          added_by?: string | null
          checked_by?: string | null
          checked_at?: string | null
          source?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          list_id?: string
          name?: string
          quantity?: string | null
          category?: string | null
          note?: string | null
          checked?: boolean
          added_by?: string | null
          checked_by?: string | null
          checked_at?: string | null
          source?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'items_list_id_fkey'
            columns: ['list_id']
            isOneToOne: false
            referencedRelation: 'lists'
            referencedColumns: ['id']
          },
        ]
      }
      category_rules: {
        Row: {
          household_id: string
          keyword: string
          category: string
          created_by: string | null
          updated_at: string
        }
        Insert: {
          household_id: string
          keyword: string
          category: string
          created_by?: string | null
          updated_at?: string
        }
        Update: {
          household_id?: string
          keyword?: string
          category?: string
          created_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'category_rules_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      api_tokens: {
        Row: {
          id: string
          user_id: string
          list_id: string
          token_hash: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          list_id: string
          token_hash: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          list_id?: string
          token_hash?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'api_tokens_list_id_fkey'
            columns: ['list_id']
            isOneToOne: false
            referencedRelation: 'lists'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_household_member: {
        Args: { hid: string }
        Returns: boolean
      }
      is_household_owner: {
        Args: { hid: string }
        Returns: boolean
      }
      can_access_list: {
        Args: { lid: string }
        Returns: boolean
      }
      can_edit_list: {
        Args: { lid: string }
        Returns: boolean
      }
      can_edit_household: {
        Args: { hid: string }
        Returns: boolean
      }
      is_household_admin: {
        Args: { hid: string }
        Returns: boolean
      }
      is_list_household_owner: {
        Args: { lid: string }
        Returns: boolean
      }
      shares_household_with: {
        Args: { uid: string }
        Returns: boolean
      }
      create_household: {
        Args: { p_name: string }
        Returns: Json
      }
      join_household_by_code: {
        Args: { code: string }
        Returns: string
      }
      leave_household: {
        Args: { hid: string }
        Returns: undefined
      }
      regenerate_join_code: {
        Args: { hid: string }
        Returns: string
      }
      set_member_role: {
        Args: { hid: string; target: string; new_role: string }
        Returns: undefined
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

/* ── Convenience row aliases ──────────────────────────────────────────────── */

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update']

export type Profile = Tables<'profiles'>
export type Household = Tables<'households'>
export type HouseholdMember = Tables<'household_members'>
export type List = Tables<'lists'>
export type Item = Tables<'items'>
export type ApiToken = Tables<'api_tokens'>

export type ItemInsert = TablesInsert<'items'>
export type ItemUpdate = TablesUpdate<'items'>

/** Payload returned by the `create_household` RPC. */
export type CreatedHousehold = {
  household_id: string
  join_code: string
  list_id: string
}

export function isCreatedHousehold(value: unknown): value is CreatedHousehold {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.household_id === 'string' &&
    typeof v.join_code === 'string' &&
    typeof v.list_id === 'string'
  )
}
