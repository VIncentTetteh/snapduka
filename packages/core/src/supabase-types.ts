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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      abandoned_checkouts: {
        Row: {
          campaign_token: string | null
          cart_snapshot: Json
          consent: boolean
          contact: string
          created_at: string
          id: string
          recovered_order_id: string | null
          remind_after: string
          reminded_at: string | null
          seller_account_id: string
          shop_id: string
        }
        Insert: {
          campaign_token?: string | null
          cart_snapshot: Json
          consent?: boolean
          contact: string
          created_at?: string
          id?: string
          recovered_order_id?: string | null
          remind_after: string
          reminded_at?: string | null
          seller_account_id: string
          shop_id: string
        }
        Update: {
          campaign_token?: string | null
          cart_snapshot?: Json
          consent?: boolean
          contact?: string
          created_at?: string
          id?: string
          recovered_order_id?: string | null
          remind_after?: string
          reminded_at?: string | null
          seller_account_id?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abandoned_checkouts_recovered_order_id_fkey"
            columns: ["recovered_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandoned_checkouts_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abandoned_checkouts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          auth_user_id: string
          completed_at: string | null
          id: string
          reason: string | null
          requested_at: string
          seller_account_id: string
          status: string
        }
        Insert: {
          auth_user_id: string
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          seller_account_id: string
          status?: string
        }
        Update: {
          auth_user_id?: string
          completed_at?: string | null
          id?: string
          reason?: string | null
          requested_at?: string
          seller_account_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          campaign: string | null
          country: Database["public"]["Enums"]["country_code"] | null
          created_at: string
          dimensions: Json
          event_type: string
          id: string
          product_id: string | null
          seller_account_id: string
          session_id: string
          shop_id: string
          source: string | null
        }
        Insert: {
          campaign?: string | null
          country?: Database["public"]["Enums"]["country_code"] | null
          created_at?: string
          dimensions?: Json
          event_type: string
          id: string
          product_id?: string | null
          seller_account_id: string
          session_id: string
          shop_id: string
          source?: string | null
        }
        Update: {
          campaign?: string | null
          country?: Database["public"]["Enums"]["country_code"] | null
          created_at?: string
          dimensions?: Json
          event_type?: string
          id?: string
          product_id?: string | null
          seller_account_id?: string
          session_id?: string
          shop_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          seller_account_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          seller_account_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_logs: {
        Row: {
          api_key_id: string
          created_at: string
          id: string
          method: string
          path: string
          request_id: string
          seller_account_id: string
          status: number | null
        }
        Insert: {
          api_key_id: string
          created_at?: string
          id?: string
          method: string
          path: string
          request_id: string
          seller_account_id: string
          status?: number | null
        }
        Update: {
          api_key_id?: string
          created_at?: string
          id?: string
          method?: string
          path?: string
          request_id?: string
          seller_account_id?: string
          status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_data: Json | null
          before_data: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          occurred_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          action: Json
          active: boolean
          conditions: Json
          created_at: string
          event_type: string
          id: string
          name: string
          seller_account_id: string
        }
        Insert: {
          action: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          event_type: string
          id?: string
          name: string
          seller_account_id: string
        }
        Update: {
          action?: Json
          active?: boolean
          conditions?: Json
          created_at?: string
          event_type?: string
          id?: string
          name?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          created_at: string
          depth: number
          event_id: string
          id: string
          result: Json | null
          rule_id: string
          seller_account_id: string
          state: string
        }
        Insert: {
          created_at?: string
          depth?: number
          event_id: string
          id?: string
          result?: Json | null
          rule_id: string
          seller_account_id: string
          state?: string
        }
        Update: {
          created_at?: string
          depth?: number
          event_id?: string
          id?: string
          result?: Json | null
          rule_id?: string
          seller_account_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_attributions: {
        Row: {
          campaign_id: string
          click_count: number
          converted_at: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          order_id: string | null
          seller_account_id: string
          session_key: string | null
          source: string
          visitor_key: string | null
        }
        Insert: {
          campaign_id: string
          click_count?: number
          converted_at?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          order_id?: string | null
          seller_account_id: string
          session_key?: string | null
          source?: string
          visitor_key?: string | null
        }
        Update: {
          campaign_id?: string
          click_count?: number
          converted_at?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          order_id?: string | null
          seller_account_id?: string
          session_key?: string | null
          source?: string
          visitor_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_attributions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_attributions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_attributions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_links: {
        Row: {
          active: boolean
          campaign_id: string | null
          channel: string
          created_at: string
          creator_partnership_id: string | null
          destination_path: string
          id: string
          name: string
          seller_account_id: string
          shop_id: string
          token: string
        }
        Insert: {
          active?: boolean
          campaign_id?: string | null
          channel: string
          created_at?: string
          creator_partnership_id?: string | null
          destination_path?: string
          id?: string
          name: string
          seller_account_id: string
          shop_id: string
          token: string
        }
        Update: {
          active?: boolean
          campaign_id?: string | null
          channel?: string
          created_at?: string
          creator_partnership_id?: string | null
          destination_path?: string
          id?: string
          name?: string
          seller_account_id?: string
          shop_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_links_creator_partnership_id_fkey"
            columns: ["creator_partnership_id"]
            isOneToOne: false
            referencedRelation: "creator_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_links_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_links_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_products: {
        Row: {
          campaign_id: string
          created_at: string
          product_id: string
          seller_account_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          product_id: string
          seller_account_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          product_id?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_products_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_products_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          budget_minor: number | null
          created_at: string
          creative_path: string | null
          ends_at: string | null
          id: string
          name: string
          notes: string | null
          objective: string | null
          seller_account_id: string
          shop_id: string
          spend_minor: number
          starts_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          updated_at: string
        }
        Insert: {
          budget_minor?: number | null
          created_at?: string
          creative_path?: string | null
          ends_at?: string | null
          id?: string
          name: string
          notes?: string | null
          objective?: string | null
          seller_account_id: string
          shop_id: string
          spend_minor?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Update: {
          budget_minor?: number | null
          created_at?: string
          creative_path?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          objective?: string | null
          seller_account_id?: string
          shop_id?: string
          spend_minor?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      case_evidence: {
        Row: {
          case_id: string
          created_at: string
          id: string
          media_type: string
          object_path: string
          uploader_id: string | null
          uploader_type: Database["public"]["Enums"]["actor_type"]
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          media_type: string
          object_path: string
          uploader_id?: string | null
          uploader_type: Database["public"]["Enums"]["actor_type"]
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          media_type?: string
          object_path?: string
          uploader_id?: string | null
          uploader_type?: Database["public"]["Enums"]["actor_type"]
        }
        Relationships: [
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_messages: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          body: string
          case_id: string
          created_at: string
          id: string
          operator_only: boolean
        }
        Insert: {
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          body: string
          case_id: string
          created_at?: string
          id?: string
          operator_only?: boolean
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          operator_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "case_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      collection_products: {
        Row: {
          collection_id: string
          created_at: string
          position: number
          product_id: string
          seller_account_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          position?: number
          product_id: string
          seller_account_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          position?: number
          product_id?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          name: string
          seller_account_id: string
          shop_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name: string
          seller_account_id: string
          shop_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          name?: string
          seller_account_id?: string
          shop_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      country_configs: {
        Row: {
          address_config: Json
          address_fields: string[]
          calling_code: string
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          enabled: boolean
          minimum_payout_minor: number
          payout_auto_approve_max_minor: number
          payout_daily_cap_minor: number | null
          payout_fee_minor: number
          payout_hold_days: number
          payouts_enabled: boolean
          platform_fee_bps: number
          settlement_mode: string
          updated_at: string
        }
        Insert: {
          address_config?: Json
          address_fields: string[]
          calling_code: string
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          enabled?: boolean
          minimum_payout_minor?: number
          payout_auto_approve_max_minor?: number
          payout_daily_cap_minor?: number | null
          payout_fee_minor?: number
          payout_hold_days?: number
          payouts_enabled?: boolean
          platform_fee_bps?: number
          settlement_mode?: string
          updated_at?: string
        }
        Update: {
          address_config?: Json
          address_fields?: string[]
          calling_code?: string
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          enabled?: boolean
          minimum_payout_minor?: number
          payout_auto_approve_max_minor?: number
          payout_daily_cap_minor?: number | null
          payout_fee_minor?: number
          payout_hold_days?: number
          payouts_enabled?: boolean
          platform_fee_bps?: number
          settlement_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      courier_connections: {
        Row: {
          active: boolean
          created_at: string
          credentials_encrypted: string | null
          id: string
          provider: string
          seller_account_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          provider: string
          seller_account_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          provider?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_connections_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_quotes: {
        Row: {
          amount_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          expires_at: string
          id: string
          order_id: string
          provider: string
          provider_quote_id: string | null
          seller_account_id: string
          service: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          expires_at: string
          id?: string
          order_id: string
          provider: string
          provider_quote_id?: string | null
          seller_account_id: string
          service: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          expires_at?: string
          id?: string
          order_id?: string
          provider?: string
          provider_quote_id?: string | null
          seller_account_id?: string
          service?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_quotes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_quotes_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_commission_adjustments: {
        Row: {
          commission_id: string
          created_at: string
          created_by: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          delta_minor: number
          id: string
          reason: string
          seller_account_id: string
        }
        Insert: {
          commission_id: string
          created_at?: string
          created_by?: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          delta_minor: number
          id?: string
          reason: string
          seller_account_id: string
        }
        Update: {
          commission_id?: string
          created_at?: string
          created_by?: string
          creator_id?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          delta_minor?: number
          id?: string
          reason?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_commission_adjustments_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "creator_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commission_adjustments_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commission_adjustments_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_commission_payments: {
        Row: {
          amount_minor: number
          confirmed_at: string | null
          created_at: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          dispute_note: string | null
          disputed_at: string | null
          external_reference: string | null
          id: string
          marked_at: string
          marked_by: string
          method: string
          note: string | null
          reference: string
          seller_account_id: string
        }
        Insert: {
          amount_minor: number
          confirmed_at?: string | null
          created_at?: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          dispute_note?: string | null
          disputed_at?: string | null
          external_reference?: string | null
          id?: string
          marked_at?: string
          marked_by: string
          method: string
          note?: string | null
          reference?: string
          seller_account_id: string
        }
        Update: {
          amount_minor?: number
          confirmed_at?: string | null
          created_at?: string
          creator_id?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          dispute_note?: string | null
          disputed_at?: string | null
          external_reference?: string | null
          id?: string
          marked_at?: string
          marked_by?: string
          method?: string
          note?: string | null
          reference?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_commission_payments_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commission_payments_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_commissions: {
        Row: {
          accrued_at: string
          amount_minor: number
          attribution_id: string | null
          basis_minor: number
          campaign_id: string | null
          created_at: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          hold_days: number
          id: string
          order_id: string
          order_placed_at: string
          order_reference: string
          paid_at: string | null
          partnership_id: string
          payable_at: string
          payment_id: string | null
          rate_bps: number
          reversal_reason: string | null
          reversed_at: string | null
          seller_account_id: string
          shop_display_name: string
          status: Database["public"]["Enums"]["commission_status"]
          updated_at: string
        }
        Insert: {
          accrued_at?: string
          amount_minor: number
          attribution_id?: string | null
          basis_minor: number
          campaign_id?: string | null
          created_at?: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          hold_days: number
          id?: string
          order_id: string
          order_placed_at: string
          order_reference: string
          paid_at?: string | null
          partnership_id: string
          payable_at: string
          payment_id?: string | null
          rate_bps: number
          reversal_reason?: string | null
          reversed_at?: string | null
          seller_account_id: string
          shop_display_name: string
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Update: {
          accrued_at?: string
          amount_minor?: number
          attribution_id?: string | null
          basis_minor?: number
          campaign_id?: string | null
          created_at?: string
          creator_id?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          hold_days?: number
          id?: string
          order_id?: string
          order_placed_at?: string
          order_reference?: string
          paid_at?: string | null
          partnership_id?: string
          payable_at?: string
          payment_id?: string | null
          rate_bps?: number
          reversal_reason?: string | null
          reversed_at?: string | null
          seller_account_id?: string
          shop_display_name?: string
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_commissions_attribution_id_fkey"
            columns: ["attribution_id"]
            isOneToOne: false
            referencedRelation: "campaign_attributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "creator_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "creator_commission_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_commissions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_invitations: {
        Row: {
          accepted_at: string | null
          contact: string
          contact_kind: string
          created_at: string
          expires_at: string
          hold_days: number
          id: string
          invited_by: string
          rate_bps: number
          revoked_at: string | null
          seller_account_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          contact: string
          contact_kind: string
          created_at?: string
          expires_at: string
          hold_days?: number
          id?: string
          invited_by: string
          rate_bps: number
          revoked_at?: string | null
          seller_account_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          contact?: string
          contact_kind?: string
          created_at?: string
          expires_at?: string
          hold_days?: number
          id?: string
          invited_by?: string
          rate_bps?: number
          revoked_at?: string | null
          seller_account_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_invitations_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_partnerships: {
        Row: {
          accepted_at: string | null
          created_at: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          ended_at: string | null
          hold_days: number
          id: string
          invited_at: string
          rate_bps: number
          seller_account_id: string
          status: Database["public"]["Enums"]["partnership_status"]
          terms_note: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          ended_at?: string | null
          hold_days?: number
          id?: string
          invited_at?: string
          rate_bps: number
          seller_account_id: string
          status?: Database["public"]["Enums"]["partnership_status"]
          terms_note?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          creator_id?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          ended_at?: string | null
          hold_days?: number
          id?: string
          invited_at?: string
          rate_bps?: number
          seller_account_id?: string
          status?: Database["public"]["Enums"]["partnership_status"]
          terms_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_partnerships_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_partnerships_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          auth_user_id: string
          contact_email: string | null
          contact_phone: string
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          display_name: string
          handle: string
          id: string
          payout_details: Json
          status: Database["public"]["Enums"]["creator_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          contact_email?: string | null
          contact_phone: string
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          display_name: string
          handle: string
          id?: string
          payout_details?: Json
          status?: Database["public"]["Enums"]["creator_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          contact_email?: string | null
          contact_phone?: string
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          display_name?: string
          handle?: string
          id?: string
          payout_details?: Json
          status?: Database["public"]["Enums"]["creator_status"]
          updated_at?: string
        }
        Relationships: []
      }
      custom_domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
          last_checked_at: string | null
          seller_account_id: string
          shop_id: string
          status: Database["public"]["Enums"]["domain_status"]
          verification_token: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          last_checked_at?: string | null
          seller_account_id: string
          shop_id: string
          status?: Database["public"]["Enums"]["domain_status"]
          verification_token?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          last_checked_at?: string | null
          seller_account_id?: string
          shop_id?: string
          status?: Database["public"]["Enums"]["domain_status"]
          verification_token?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_domains_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_domains_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consents: {
        Row: {
          captured_at: string
          customer_id: string
          id: string
          purpose: string
          seller_account_id: string
          source: string
          status: Database["public"]["Enums"]["consent_status"]
        }
        Insert: {
          captured_at?: string
          customer_id: string
          id?: string
          purpose: string
          seller_account_id: string
          source?: string
          status: Database["public"]["Enums"]["consent_status"]
        }
        Update: {
          captured_at?: string
          customer_id?: string
          id?: string
          purpose?: string
          seller_account_id?: string
          source?: string
          status?: Database["public"]["Enums"]["consent_status"]
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consents_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          created_at: string
          id: string
          name: string
          rules: Json
          seller_account_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          rules?: Json
          seller_account_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          rules?: Json
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          seller_account_id: string
          tag: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          seller_account_id: string
          tag: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          seller_account_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_tags_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          seller_account_id: string
          updated_at: string
        }
        Insert: {
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          email: string
          id?: string
          name: string
          phone: string
          seller_account_id: string
          updated_at?: string
        }
        Update: {
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string
          seller_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          active: boolean
          app_version: string | null
          auth_user_id: string
          created_at: string
          device_id: string | null
          expo_push_token: string
          id: string
          last_seen_at: string
          platform: string
          seller_account_id: string
        }
        Insert: {
          active?: boolean
          app_version?: string | null
          auth_user_id: string
          created_at?: string
          device_id?: string | null
          expo_push_token: string
          id?: string
          last_seen_at?: string
          platform: string
          seller_account_id: string
        }
        Update: {
          active?: boolean
          app_version?: string | null
          auth_user_id?: string
          created_at?: string
          device_id?: string | null
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          platform?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_listings: {
        Row: {
          active: boolean
          category: string | null
          city: string | null
          country: Database["public"]["Enums"]["country_code"]
          description: string | null
          display_name: string
          quality_score: number
          refreshed_at: string
          seller_account_id: string
          shop_id: string
          slug: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          city?: string | null
          country: Database["public"]["Enums"]["country_code"]
          description?: string | null
          display_name: string
          quality_score?: number
          refreshed_at?: string
          seller_account_id: string
          shop_id: string
          slug: string
        }
        Update: {
          active?: boolean
          category?: string | null
          city?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          description?: string | null
          display_name?: string
          quality_score?: number
          refreshed_at?: string
          seller_account_id?: string
          shop_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_listings_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_listings_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_preferences: {
        Row: {
          category: string | null
          city: string | null
          description: string | null
          operator_removed_at: string | null
          opted_in: boolean
          seller_account_id: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          city?: string | null
          description?: string | null
          operator_removed_at?: string | null
          opted_in?: boolean
          seller_account_id: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          city?: string | null
          description?: string | null
          operator_removed_at?: string | null
          opted_in?: boolean
          seller_account_id?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_preferences_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_preferences_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          created_at: string
          expires_at: string | null
          export_type: string
          filters: Json
          id: string
          object_path: string | null
          seller_account_id: string
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          export_type: string
          filters?: Json
          id?: string
          object_path?: string | null
          seller_account_id: string
          state?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          export_type?: string
          filters?: Json
          id?: string
          object_path?: string | null
          seller_account_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_events: {
        Row: {
          amount_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          data: Json
          event_type: string
          id: string
          order_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          data?: Json
          event_type: string
          id?: string
          order_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          data?: Json
          event_type?: string
          id?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      fulfillment_methods: {
        Row: {
          active: boolean
          created_at: string
          fee_minor: number
          id: string
          instructions: string
          name: string
          position: number
          seller_account_id: string
          shop_id: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          fee_minor?: number
          id?: string
          instructions?: string
          name: string
          position?: number
          seller_account_id: string
          shop_id: string
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          fee_minor?: number
          id?: string
          instructions?: string
          name?: string
          position?: number
          seller_account_id?: string
          shop_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_methods_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fulfillment_methods_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          key: string
          response: Json
          scope: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          key: string
          response: Json
          scope: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
          response?: Json
          scope?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity_delta: number
          reason: string
          reference: string | null
          seller_account_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity_delta: number
          reason: string
          reference?: string | null
          seller_account_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity_delta?: number
          reason?: string
          reference?: string | null
          seller_account_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          balance_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          entry_count: number
          id: string
          kind: Database["public"]["Enums"]["ledger_account_kind"]
          normal_balance: Database["public"]["Enums"]["ledger_normal_balance"]
          owner_seller_account_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          balance_minor?: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          entry_count?: number
          id?: string
          kind: Database["public"]["Enums"]["ledger_account_kind"]
          normal_balance: Database["public"]["Enums"]["ledger_normal_balance"]
          owner_seller_account_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          balance_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          entry_count?: number
          id?: string
          kind?: Database["public"]["Enums"]["ledger_account_kind"]
          normal_balance?: Database["public"]["Enums"]["ledger_normal_balance"]
          owner_seller_account_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_owner_seller_account_id_fkey"
            columns: ["owner_seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account_id: string
          amount_minor: number
          balance_after_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          seller_account_id: string | null
          transaction_id: string
        }
        Insert: {
          account_id: string
          amount_minor: number
          balance_after_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          seller_account_id?: string | null
          transaction_id: string
        }
        Update: {
          account_id?: string
          amount_minor?: number
          balance_after_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          seller_account_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_reconciliations: {
        Row: {
          currency: Database["public"]["Enums"]["currency_code"]
          detail: Json
          drift_minor: number
          id: string
          ledger_clearing_minor: number
          provider_balance_minor: number | null
          run_at: string
          seller_liability_minor: number
          status: string
        }
        Insert: {
          currency: Database["public"]["Enums"]["currency_code"]
          detail?: Json
          drift_minor: number
          id?: string
          ledger_clearing_minor: number
          provider_balance_minor?: number | null
          run_at?: string
          seller_liability_minor: number
          status: string
        }
        Update: {
          currency?: Database["public"]["Enums"]["currency_code"]
          detail?: Json
          drift_minor?: number
          id?: string
          ledger_clearing_minor?: number
          provider_balance_minor?: number | null
          run_at?: string
          seller_liability_minor?: number
          status?: string
        }
        Relationships: []
      }
      ledger_transactions: {
        Row: {
          currency: Database["public"]["Enums"]["currency_code"]
          event_key: string
          id: string
          kind: string
          metadata: Json
          order_id: string | null
          payout_request_id: string | null
          posted_at: string
          reason: string | null
          refund_id: string | null
          seller_account_id: string | null
        }
        Insert: {
          currency: Database["public"]["Enums"]["currency_code"]
          event_key: string
          id?: string
          kind: string
          metadata?: Json
          order_id?: string | null
          payout_request_id?: string | null
          posted_at?: string
          reason?: string | null
          refund_id?: string | null
          seller_account_id?: string | null
        }
        Update: {
          currency?: Database["public"]["Enums"]["currency_code"]
          event_key?: string
          id?: string
          kind?: string
          metadata?: Json
          order_id?: string | null
          payout_request_id?: string | null
          posted_at?: string
          reason?: string | null
          refund_id?: string | null
          seller_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_payout_request_id_fkey"
            columns: ["payout_request_id"]
            isOneToOne: false
            referencedRelation: "payout_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_broadcasts: {
        Row: {
          body: string
          channel: string
          created_at: string
          id: string
          scheduled_at: string | null
          segment_id: string | null
          seller_account_id: string
          state: string
          subject: string | null
        }
        Insert: {
          body: string
          channel: string
          created_at?: string
          id?: string
          scheduled_at?: string | null
          segment_id?: string | null
          seller_account_id: string
          state?: string
          subject?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          id?: string
          scheduled_at?: string | null
          segment_id?: string | null
          seller_account_id?: string
          state?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_broadcasts_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_broadcasts_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_deliveries: {
        Row: {
          broadcast_id: string
          customer_id: string
          id: string
          reason: string | null
          seller_account_id: string
          sent_at: string | null
          state: string
        }
        Insert: {
          broadcast_id: string
          customer_id: string
          id?: string
          reason?: string | null
          seller_account_id: string
          sent_at?: string | null
          state?: string
        }
        Update: {
          broadcast_id?: string
          customer_id?: string
          id?: string
          reason?: string | null
          seller_account_id?: string
          sent_at?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_deliveries_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "marketing_broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_deliveries_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_attempts: {
        Row: {
          attempt: number
          created_at: string
          error: string | null
          id: string
          notification_id: string
          outcome: string
        }
        Insert: {
          attempt: number
          created_at?: string
          error?: string | null
          id?: string
          notification_id: string
          outcome: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error?: string | null
          id?: string
          notification_id?: string
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_attempts_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          digest_frequency: string
          marketing_frequency_cap: number
          order_email: boolean
          order_sms: boolean
          order_whatsapp: boolean
          seller_account_id: string
          updated_at: string
        }
        Insert: {
          digest_frequency?: string
          marketing_frequency_cap?: number
          order_email?: boolean
          order_sms?: boolean
          order_whatsapp?: boolean
          seller_account_id: string
          updated_at?: string
        }
        Update: {
          digest_frequency?: string
          marketing_frequency_cap?: number
          order_email?: boolean
          order_sms?: boolean
          order_whatsapp?: boolean
          seller_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: true
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          available_at: string
          channel: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          order_id: string | null
          payload: Json
          read_at: string | null
          recipient: string
          seller_account_id: string
          status: Database["public"]["Enums"]["notification_status"]
          template: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          channel: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json
          read_at?: string | null
          recipient: string
          seller_account_id: string
          status?: Database["public"]["Enums"]["notification_status"]
          template: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          channel?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json
          read_at?: string | null
          recipient?: string
          seller_account_id?: string
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          buyer_visible: boolean
          created_at: string
          data: Json
          event_type: string
          id: string
          order_id: string
          seller_account_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          buyer_visible?: boolean
          created_at?: string
          data?: Json
          event_type: string
          id?: string
          order_id: string
          seller_account_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          buyer_visible?: boolean
          created_at?: string
          data?: Json
          event_type?: string
          id?: string
          order_id?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          created_at: string
          id: string
          line_total_minor: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku: string | null
          snapshot: Json
          unit_cost_minor: number | null
          unit_price_minor: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_minor: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku?: string | null
          snapshot: Json
          unit_cost_minor?: number | null
          unit_price_minor: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          line_total_minor?: number
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          sku?: string | null
          snapshot?: Json
          unit_cost_minor?: number | null
          unit_price_minor?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_settlements: {
        Row: {
          captured_at: string
          clawed_back_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          gross_minor: number
          hold_days: number
          id: string
          order_id: string
          payment_attempt_id: string | null
          pending_minor: number
          platform_fee_bps: number
          platform_fee_minor: number
          psp_fee_minor: number
          release_at: string | null
          released_at: string | null
          released_minor: number
          seller_account_id: string
          seller_gross_minor: number
          status: string
          updated_at: string
        }
        Insert: {
          captured_at?: string
          clawed_back_minor?: number
          currency: Database["public"]["Enums"]["currency_code"]
          gross_minor: number
          hold_days: number
          id?: string
          order_id: string
          payment_attempt_id?: string | null
          pending_minor: number
          platform_fee_bps: number
          platform_fee_minor: number
          psp_fee_minor?: number
          release_at?: string | null
          released_at?: string | null
          released_minor?: number
          seller_account_id: string
          seller_gross_minor: number
          status?: string
          updated_at?: string
        }
        Update: {
          captured_at?: string
          clawed_back_minor?: number
          currency?: Database["public"]["Enums"]["currency_code"]
          gross_minor?: number
          hold_days?: number
          id?: string
          order_id?: string
          payment_attempt_id?: string | null
          pending_minor?: number
          platform_fee_bps?: number
          platform_fee_minor?: number
          psp_fee_minor?: number
          release_at?: string | null
          released_at?: string | null
          released_minor?: number
          seller_account_id?: string
          seller_gross_minor?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_settlements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_settlements_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_settlements_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_snapshot: Json
          campaign_snapshot: Json | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          delivery_minor: number
          discount_minor: number
          dispute_status: Database["public"]["Enums"]["dispute_status"]
          event_version: number
          fulfilled_at: string | null
          fulfillment_method_snapshot: Json
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          id: string
          payment_method: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          promotion_snapshot: Json | null
          public_reference: string
          refund_status: Database["public"]["Enums"]["refund_status"]
          seller_account_id: string
          shop_id: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal_minor: number
          total_minor: number
          tracking_token: string
          updated_at: string
        }
        Insert: {
          buyer_snapshot: Json
          campaign_snapshot?: Json | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          delivery_minor: number
          discount_minor?: number
          dispute_status?: Database["public"]["Enums"]["dispute_status"]
          event_version?: number
          fulfilled_at?: string | null
          fulfillment_method_snapshot: Json
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          payment_method: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          promotion_snapshot?: Json | null
          public_reference?: string
          refund_status?: Database["public"]["Enums"]["refund_status"]
          seller_account_id: string
          shop_id: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor: number
          total_minor: number
          tracking_token?: string
          updated_at?: string
        }
        Update: {
          buyer_snapshot?: Json
          campaign_snapshot?: Json | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          customer_id?: string
          delivery_minor?: number
          discount_minor?: number
          dispute_status?: Database["public"]["Enums"]["dispute_status"]
          event_version?: number
          fulfilled_at?: string | null
          fulfillment_method_snapshot?: Json
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          id?: string
          payment_method?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          promotion_snapshot?: Json | null
          public_reference?: string
          refund_status?: Database["public"]["Enums"]["refund_status"]
          seller_account_id?: string
          shop_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor?: number
          total_minor?: number
          tracking_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_webhooks: {
        Row: {
          active: boolean
          created_at: string
          event_types: string[]
          id: string
          secret_id: string | null
          seller_account_id: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_types: string[]
          id?: string
          secret_id: string | null
          seller_account_id: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_types?: string[]
          id?: string
          secret_id?: string | null
          seller_account_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_webhooks_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          order_id: string
          provider: string
          provider_data: Json
          reference: string
          seller_account_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          order_id: string
          provider?: string
          provider_data?: Json
          reference: string
          seller_account_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          order_id?: string
          provider?: string
          provider_data?: Json
          reference?: string
          seller_account_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_attempts_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_subaccounts: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          percentage_charge_bps: number | null
          provider: string
          provider_subaccount_code: string | null
          provider_subaccount_id: string | null
          request_fingerprint: string | null
          seller_account_id: string
          status: Database["public"]["Enums"]["payment_subaccount_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          percentage_charge_bps?: number | null
          provider: string
          provider_subaccount_code?: string | null
          provider_subaccount_id?: string | null
          request_fingerprint?: string | null
          seller_account_id: string
          status?: Database["public"]["Enums"]["payment_subaccount_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          percentage_charge_bps?: number | null
          provider?: string
          provider_subaccount_code?: string | null
          provider_subaccount_id?: string | null
          request_fingerprint?: string | null
          seller_account_id?: string
          status?: Database["public"]["Enums"]["payment_subaccount_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_subaccounts_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_destinations: {
        Row: {
          account_last4: string
          activated_at: string | null
          bank_code: string
          bank_name: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          metadata: Json
          provider: string
          recipient_code: string | null
          request_fingerprint: string
          resolved_account_name: string | null
          revoked_at: string | null
          seller_account_id: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          account_last4: string
          activated_at?: string | null
          bank_code: string
          bank_name: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          metadata?: Json
          provider?: string
          recipient_code?: string | null
          request_fingerprint: string
          resolved_account_name?: string | null
          revoked_at?: string | null
          seller_account_id: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_last4?: string
          activated_at?: string | null
          bank_code?: string
          bank_name?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          metadata?: Json
          provider?: string
          recipient_code?: string | null
          request_fingerprint?: string
          resolved_account_name?: string | null
          revoked_at?: string | null
          seller_account_id?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_destinations_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_requests: {
        Row: {
          amount_minor: number
          claimed_at: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          destination: Json
          failure_reason: string | null
          fee_minor: number
          id: string
          idempotency_key: string | null
          net_minor: number | null
          paid_at: string | null
          payout_destination_id: string | null
          provider_transfer_code: string | null
          provider_transfer_id: string | null
          reference: string
          requested_by: string | null
          reserve_ledger_txn_id: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          seller_account_id: string
          settle_ledger_txn_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          claimed_at?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          destination?: Json
          failure_reason?: string | null
          fee_minor?: number
          id?: string
          idempotency_key?: string | null
          net_minor?: number | null
          paid_at?: string | null
          payout_destination_id?: string | null
          provider_transfer_code?: string | null
          provider_transfer_id?: string | null
          reference?: string
          requested_by?: string | null
          reserve_ledger_txn_id?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_account_id: string
          settle_ledger_txn_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          claimed_at?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          destination?: Json
          failure_reason?: string | null
          fee_minor?: number
          id?: string
          idempotency_key?: string | null
          net_minor?: number | null
          paid_at?: string | null
          payout_destination_id?: string | null
          provider_transfer_code?: string | null
          provider_transfer_id?: string | null
          reference?: string
          requested_by?: string | null
          reserve_ledger_txn_id?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_account_id?: string
          settle_ledger_txn_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_payout_destination_id_fkey"
            columns: ["payout_destination_id"]
            isOneToOne: false
            referencedRelation: "payout_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_reserve_ledger_txn_id_fkey"
            columns: ["reserve_ledger_txn_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_settle_ledger_txn_id_fkey"
            columns: ["settle_ledger_txn_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_prices: {
        Row: {
          active: boolean
          amount_minor: number
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          interval: string
          plan_id: string
          provider: string
          provider_plan_code: string | null
        }
        Insert: {
          active?: boolean
          amount_minor: number
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          interval: string
          plan_id: string
          provider?: string
          provider_plan_code?: string | null
        }
        Update: {
          active?: boolean
          amount_minor?: number
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          interval?: string
          plan_id?: string
          provider?: string
          provider_plan_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          code: string
          created_at: string
          entitlements: Json
          id: string
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          entitlements?: Json
          id?: string
          name: string
          updated_at?: string
          version: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          entitlements?: Json
          id?: string
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      policy_acceptances: {
        Row: {
          accepted_at: string
          accepted_by_user_id: string
          created_at: string
          id: string
          policy_key: string
          policy_version: string
          seller_account_id: string
        }
        Insert: {
          accepted_at?: string
          accepted_by_user_id?: string
          created_at?: string
          id?: string
          policy_key: string
          policy_version: string
          seller_account_id: string
        }
        Update: {
          accepted_at?: string
          accepted_by_user_id?: string
          created_at?: string
          id?: string
          policy_key?: string
          policy_version?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_acceptances_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          assigned_by: string | null
          category_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          assigned_by?: string | null
          category_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          assigned_by?: string | null
          category_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          alt_text: string
          created_at: string
          height: number
          id: string
          object_path: string
          position: number
          product_id: string
          seller_account_id: string
          width: number
        }
        Insert: {
          alt_text?: string
          created_at?: string
          height: number
          id?: string
          object_path: string
          position?: number
          product_id: string
          seller_account_id: string
          width: number
        }
        Update: {
          alt_text?: string
          created_at?: string
          height?: number
          id?: string
          object_path?: string
          position?: number
          product_id?: string
          seller_account_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_reviews: {
        Row: {
          author_name: string
          body: string | null
          created_at: string
          customer_id: string | null
          id: string
          order_id: string
          product_id: string
          rating: number
          seller_account_id: string
          seller_replied_at: string | null
          seller_reply: string | null
          shop_id: string
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          author_name: string
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          order_id: string
          product_id: string
          rating: number
          seller_account_id: string
          seller_replied_at?: string | null
          seller_reply?: string | null
          shop_id: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          author_name?: string
          body?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          order_id?: string
          product_id?: string
          rating?: number
          seller_account_id?: string
          seller_replied_at?: string | null
          seller_reply?: string | null
          shop_id?: string
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          image_path: string | null
          inventory_policy: Database["public"]["Enums"]["inventory_policy"]
          name: string
          position: number
          price_minor: number | null
          product_id: string
          reserved_quantity: number
          seller_account_id: string
          sku: string | null
          stock_quantity: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_path?: string | null
          inventory_policy?: Database["public"]["Enums"]["inventory_policy"]
          name: string
          position?: number
          price_minor?: number | null
          product_id: string
          reserved_quantity?: number
          seller_account_id: string
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_path?: string | null
          inventory_policy?: Database["public"]["Enums"]["inventory_policy"]
          name?: string
          position?: number
          price_minor?: number | null
          product_id?: string
          reserved_quantity?: number
          seller_account_id?: string
          sku?: string | null
          stock_quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          compare_at_price_minor: number | null
          cost_minor: number | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          description: string
          id: string
          inventory_policy: Database["public"]["Enums"]["inventory_policy"]
          moderated_at: string | null
          moderated_by: string | null
          moderation_reason: string | null
          moderation_status: string
          name: string
          price_minor: number
          published_at: string | null
          reserved_quantity: number
          seller_account_id: string
          shop_id: string
          sku: string | null
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          stock_quantity: number | null
          updated_at: string
          video_id: string | null
          video_provider: string | null
          video_thumbnail_url: string | null
          video_url: string | null
        }
        Insert: {
          compare_at_price_minor?: number | null
          cost_minor?: number | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          description?: string
          id?: string
          inventory_policy?: Database["public"]["Enums"]["inventory_policy"]
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          moderation_status?: string
          name: string
          price_minor: number
          published_at?: string | null
          reserved_quantity?: number
          seller_account_id: string
          shop_id: string
          sku?: string | null
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number | null
          updated_at?: string
          video_id?: string | null
          video_provider?: string | null
          video_thumbnail_url?: string | null
          video_url?: string | null
        }
        Update: {
          compare_at_price_minor?: number | null
          cost_minor?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          description?: string
          id?: string
          inventory_policy?: Database["public"]["Enums"]["inventory_policy"]
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_reason?: string | null
          moderation_status?: string
          name?: string
          price_minor?: number
          published_at?: string | null
          reserved_quantity?: number
          seller_account_id?: string
          shop_id?: string
          sku?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          stock_quantity?: number | null
          updated_at?: string
          video_id?: string | null
          video_provider?: string | null
          video_thumbnail_url?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_redemptions: {
        Row: {
          created_at: string
          customer_id: string
          discount_minor: number
          id: string
          order_id: string
          promotion_id: string
          seller_account_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          discount_minor: number
          id?: string
          order_id: string
          promotion_id: string
          seller_account_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          discount_minor?: number
          id?: string
          order_id?: string
          promotion_id?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["discount_kind"]
          maximum_minor: number | null
          minimum_minor: number
          name: string
          per_customer_limit: number
          redemption_limit: number | null
          seller_account_id: string
          shop_id: string
          starts_at: string | null
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          ends_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["discount_kind"]
          maximum_minor?: number | null
          minimum_minor?: number
          name: string
          per_customer_limit?: number
          redemption_limit?: number | null
          seller_account_id: string
          shop_id: string
          starts_at?: string | null
          value: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["discount_kind"]
          maximum_minor?: number | null
          minimum_minor?: number
          name?: string
          per_customer_limit?: number
          redemption_limit?: number | null
          seller_account_id?: string
          shop_id?: string
          starts_at?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_events: {
        Row: {
          created_at: string
          event_key: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
        }
        Insert: {
          created_at?: string
          event_key: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          provider: string
        }
        Update: {
          created_at?: string
          event_key?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          active: boolean
          auth: string
          created_at: string
          customer_id: string | null
          endpoint: string
          id: string
          p256dh: string
          seller_account_id: string | null
        }
        Insert: {
          active?: boolean
          auth: string
          created_at?: string
          customer_id?: string | null
          endpoint: string
          id?: string
          p256dh: string
          seller_account_id?: string | null
        }
        Update: {
          active?: boolean
          auth?: string
          created_at?: string
          customer_id?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          seller_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          count: number
          key: string
          reset_at: string
        }
        Insert: {
          count?: number
          key: string
          reset_at: string
        }
        Update: {
          count?: number
          key?: string
          reset_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_minor: number
          created_at: string
          id: string
          order_id: string
          payment_attempt_id: string
          provider_refund_id: string | null
          seller_account_id: string
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          id?: string
          order_id: string
          payment_attempt_id: string
          provider_refund_id?: string | null
          seller_account_id: string
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          id?: string
          order_id?: string
          payment_attempt_id?: string
          provider_refund_id?: string | null
          seller_account_id?: string
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      restock_requests: {
        Row: {
          consent: boolean
          created_at: string
          email: string | null
          id: string
          notified_at: string | null
          phone: string | null
          product_id: string
          seller_account_id: string
        }
        Insert: {
          consent?: boolean
          created_at?: string
          email?: string | null
          id?: string
          notified_at?: string | null
          phone?: string | null
          product_id: string
          seller_account_id: string
        }
        Update: {
          consent?: boolean
          created_at?: string
          email?: string | null
          id?: string
          notified_at?: string | null
          phone?: string | null
          product_id?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restock_requests_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restock_requests_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_actions: {
        Row: {
          action: string
          case_id: string | null
          created_at: string
          id: string
          operator_user_id: string
          reason: string
          seller_account_id: string
        }
        Insert: {
          action: string
          case_id?: string | null
          created_at?: string
          id?: string
          operator_user_id: string
          reason: string
          seller_account_id: string
        }
        Update: {
          action?: string
          case_id?: string | null
          created_at?: string
          id?: string
          operator_user_id?: string
          reason?: string
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_actions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_signals: {
        Row: {
          created_at: string
          details: Json
          id: string
          score: number
          seller_account_id: string
          signal_type: string
          state: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          score: number
          seller_account_id: string
          signal_type: string
          state?: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          score?: number
          seller_account_id?: string
          signal_type?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_signals_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_accounts: {
        Row: {
          auth_user_id: string
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          id: string
          is_active: boolean
          status: Database["public"]["Enums"]["seller_account_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          id?: string
          is_active?: boolean
          status?: Database["public"]["Enums"]["seller_account_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          id?: string
          is_active?: boolean
          status?: Database["public"]["Enums"]["seller_account_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_accounts_country_fkey"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "country_configs"
            referencedColumns: ["country"]
          },
        ]
      }
      seller_subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          grace_ends_at: string | null
          id: string
          pending_change_type: string | null
          pending_plan_id: string | null
          pending_plan_version: number | null
          pending_price_id: string | null
          plan_id: string
          plan_version: number
          price_id: string | null
          provider: string
          provider_authorization_code: string | null
          provider_customer_code: string | null
          provider_email_token: string | null
          provider_subscription_code: string | null
          seller_account_id: string
          state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_ends_at?: string | null
          id?: string
          pending_change_type?: string | null
          pending_plan_id?: string | null
          pending_plan_version?: number | null
          pending_price_id?: string | null
          plan_id: string
          plan_version: number
          price_id?: string | null
          provider?: string
          provider_authorization_code?: string | null
          provider_customer_code?: string | null
          provider_email_token?: string | null
          provider_subscription_code?: string | null
          seller_account_id: string
          state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_ends_at?: string | null
          id?: string
          pending_change_type?: string | null
          pending_plan_id?: string | null
          pending_plan_version?: number | null
          pending_price_id?: string | null
          plan_id?: string
          plan_version?: number
          price_id?: string | null
          provider?: string
          provider_authorization_code?: string | null
          provider_customer_code?: string | null
          provider_email_token?: string | null
          provider_subscription_code?: string | null
          seller_account_id?: string
          state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_subscriptions_pending_plan_id_fkey"
            columns: ["pending_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_subscriptions_pending_price_id_fkey"
            columns: ["pending_price_id"]
            isOneToOne: false
            referencedRelation: "plan_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_subscriptions_price_id_fkey"
            columns: ["price_id"]
            isOneToOne: false
            referencedRelation: "plan_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_subscriptions_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: true
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_verifications: {
        Row: {
          checked_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          metadata: Json
          provider: string | null
          provider_reference: string | null
          seller_account_id: string
          state: Database["public"]["Enums"]["verification_state"]
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          provider?: string | null
          provider_reference?: string | null
          seller_account_id: string
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          provider?: string | null
          provider_reference?: string | null
          seller_account_id?: string
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_verifications_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: true
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_profiles: {
        Row: {
          account_last4: string
          bank_code: string
          bank_name: string
          created_at: string
          id: string
          metadata: Json
          provider: string
          seller_account_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_last4: string
          bank_code: string
          bank_name: string
          created_at?: string
          id?: string
          metadata?: Json
          provider?: string
          seller_account_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_last4?: string
          bank_code?: string
          bank_name?: string
          created_at?: string
          id?: string
          metadata?: Json
          provider?: string
          seller_account_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_profiles_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          event_key: string
          id: string
          occurred_at: string
          payload: Json
          seller_account_id: string
          shipment_id: string
          status: string
        }
        Insert: {
          event_key: string
          id?: string
          occurred_at?: string
          payload?: Json
          seller_account_id: string
          shipment_id: string
          status: string
        }
        Update: {
          event_key?: string
          id?: string
          occurred_at?: string
          payload?: Json
          seller_account_id?: string
          shipment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          created_at: string
          id: string
          label_url: string | null
          order_id: string
          provider: string
          provider_name: string | null
          provider_shipment_id: string | null
          seller_account_id: string
          status: string
          tracking_number: string
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_url?: string | null
          order_id: string
          provider: string
          provider_name?: string | null
          provider_shipment_id?: string | null
          seller_account_id: string
          status?: string
          tracking_number: string
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label_url?: string | null
          order_id?: string
          provider?: string
          provider_name?: string | null
          provider_shipment_id?: string | null
          seller_account_id?: string
          status?: string
          tracking_number?: string
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_branding: {
        Row: {
          accent_color: string
          banner_path: string | null
          font_family: string
          hide_snapduka_branding: boolean
          logo_path: string | null
          seller_account_id: string
          shop_id: string
          surface_color: string
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          accent_color?: string
          banner_path?: string | null
          font_family?: string
          hide_snapduka_branding?: boolean
          logo_path?: string | null
          seller_account_id: string
          shop_id: string
          surface_color?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          accent_color?: string
          banner_path?: string | null
          font_family?: string
          hide_snapduka_branding?: boolean
          logo_path?: string | null
          seller_account_id?: string
          shop_id?: string
          surface_color?: string
          updated_at?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_branding_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_branding_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: true
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          display_name: string
          id: string
          legal_name: string | null
          published_at: string | null
          registration_number: string | null
          seller_account_id: string
          slug: string
          status: Database["public"]["Enums"]["shop_status"]
          unpublished_at: string | null
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          display_name: string
          id?: string
          legal_name?: string | null
          published_at?: string | null
          registration_number?: string | null
          seller_account_id: string
          slug: string
          status?: Database["public"]["Enums"]["shop_status"]
          unpublished_at?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          display_name?: string
          id?: string
          legal_name?: string | null
          published_at?: string | null
          registration_number?: string | null
          seller_account_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["shop_status"]
          unpublished_at?: string | null
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shops_country_currency_fkey"
            columns: ["country", "currency"]
            isOneToOne: false
            referencedRelation: "country_configs"
            referencedColumns: ["country", "currency"]
          },
          {
            foreignKeyName: "shops_seller_country_fkey"
            columns: ["seller_account_id", "country"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id", "country"]
          },
        ]
      }
      social_accounts: {
        Row: {
          access_token_sealed: string
          connected_at: string
          external_id: string
          handle: string
          id: string
          provider: string
          refresh_token_sealed: string | null
          scopes: string[]
          seller_account_id: string
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_sealed: string
          connected_at?: string
          external_id: string
          handle?: string
          id?: string
          provider: string
          refresh_token_sealed?: string | null
          scopes?: string[]
          seller_account_id: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_sealed?: string
          connected_at?: string
          external_id?: string
          handle?: string
          id?: string
          provider?: string
          refresh_token_sealed?: string | null
          scopes?: string[]
          seller_account_id?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          product_id: string
          quantity: number
          reference: string
          seller_account_id: string
          status: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          product_id: string
          quantity: number
          reference: string
          seller_account_id: string
          status?: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          product_id?: string
          quantity?: number
          reference?: string
          seller_account_id?: string
          status?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string
          event_key: string
          event_type: string
          id: string
          payload: Json
          seller_account_id: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          event_type: string
          id?: string
          payload?: Json
          seller_account_id: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          event_type?: string
          id?: string
          payload?: Json
          seller_account_id?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "seller_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      support_cases: {
        Row: {
          created_at: string
          description: string
          id: string
          order_id: string
          reason: string
          resolution: string | null
          response_due_at: string | null
          seller_account_id: string
          status: Database["public"]["Enums"]["dispute_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          order_id: string
          reason: string
          resolution?: string | null
          response_due_at?: string | null
          seller_account_id: string
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          order_id?: string
          reason?: string
          resolution?: string | null
          response_due_at?: string | null
          seller_account_id?: string
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["team_role"]
          seller_account_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["team_role"]
          seller_account_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          seller_account_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          active: boolean
          auth_user_id: string
          created_at: string
          email: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["team_role"]
          seller_account_id: string
        }
        Insert: {
          active?: boolean
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["team_role"]
          seller_account_id: string
        }
        Update: {
          active?: boolean
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["team_role"]
          seller_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          delivered_at: string | null
          event_id: string
          id: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          seller_account_id: string
          state: string
          webhook_id: string
        }
        Insert: {
          attempt_count?: number
          delivered_at?: string | null
          event_id: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload: Json
          seller_account_id: string
          state?: string
          webhook_id: string
        }
        Update: {
          attempt_count?: number
          delivered_at?: string | null
          event_id?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          seller_account_id?: string
          state?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "outbound_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      product_review_stats: {
        Row: {
          product_id: string | null
          rating_avg: number | null
          review_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_payment_subaccount_request: {
        Args: {
          p_auth_user_id: string
          p_reservation_id: string
          p_seller_account_id: string
        }
        Returns: boolean
      }
      activate_payout_destination: {
        Args: {
          p_destination_id: string
          p_recipient_code: string
          p_resolved_account_name?: string
        }
        Returns: boolean
      }
      admin_creator_totals: {
        Args: Record<PropertyKey, never>
        Returns: {
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          earned_minor: number
          paid_minor: number
          partnerships: number
        }[]
      }
      admin_flagged_sellers: {
        Args: Record<PropertyKey, never>
        Returns: { actions: number; seller_account_id: string }[]
      }
      admin_plan_subscription_counts: {
        Args: Record<PropertyKey, never>
        Returns: { plan_id: string; subscriptions: number }[]
      }
      admin_seller_order_totals: {
        Args: Record<PropertyKey, never>
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          gmv_minor: number
          paid_orders: number
          seller_account_id: string
        }[]
      }
      admin_subaccount_fee_drift: {
        Args: Record<PropertyKey, never>
        Returns: {
          country: Database["public"]["Enums"]["country_code"]
          stale: number
          total: number
        }[]
      }
      apply_paystack_refund_event: {
        Args: {
          p_event_key: string
          p_payload: Json
          p_provider_refund_id: string
          p_status: string
        }
        Returns: boolean
      }
      apply_paystack_success: {
        Args: { p_event_key: string; p_payload: Json; p_reference: string }
        Returns: boolean
      }
      apply_paystack_transfer_event: {
        Args: {
          p_event_key: string
          p_payload: Json
          p_reference: string
          p_status: string
          p_transfer_id: string
        }
        Returns: boolean
      }
      apply_refund_to_ledger: { Args: { p_refund_id: string }; Returns: string }
      bootstrap_creator_account: {
        Args: {
          p_contact_email?: string
          p_contact_phone: string
          p_country: Database["public"]["Enums"]["country_code"]
          p_display_name: string
          p_handle: string
        }
        Returns: string
      }
      bootstrap_seller_account: {
        Args: {
          p_auth_user_id: string
          p_contact_name: string
          p_contact_phone: string
          p_country: Database["public"]["Enums"]["country_code"]
        }
        Returns: string
      }
      campaign_link_totals: {
        Args: never
        Returns: {
          campaign_id: string
          clicks: number
          orders: number
        }[]
      }
      campaign_totals: {
        Args: never
        Returns: {
          campaign_id: string
          clicks: number
          orders: number
          revenue_minor: number
        }[]
      }
      capture_order_settlement: {
        Args: {
          p_order_id: string
          p_payment_attempt_id: string
          p_psp_fee_minor?: number
          p_reference: string
        }
        Returns: string
      }
      check_ledger_invariants: {
        Args: never
        Returns: {
          check_name: string
          detail: string
        }[]
      }
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_ms: number }
        Returns: {
          allowed: boolean
          retry_after_ms: number
        }[]
      }
      claim_payout_for_transfer: {
        Args: { p_payout_id: string }
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          net_minor: number
          payout_id: string
          recipient_code: string
          reference: string
        }[]
      }
      create_guest_order: {
        Args: {
          p_buyer: Json
          p_fulfillment_method_id: string
          p_idempotency_key: string
          p_lines: Json
          p_payment_method: string
          p_shop_id: string
        }
        Returns: Json
      }
      create_guest_order_growth: {
        Args: {
          p_buyer: Json
          p_campaign_token?: string
          p_click_id?: string
          p_fulfillment_method_id: string
          p_idempotency_key: string
          p_lines: Json
          p_payment_method: string
          p_promotion_code?: string
          p_shop_id: string
        }
        Returns: Json
      }
      creator_commission_balances: {
        Args: { p_creator_id: string }
        Returns: {
          carry_over_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          owed_now_minor: number
          paid_minor: number
          payable_minor: number
          pending_minor: number
          reversed_minor: number
        }[]
      }
      create_outbound_webhook: {
        Args: { p_event_types: string[]; p_secret: string; p_url: string }
        Returns: string
      }
      current_creator_id: { Args: never; Returns: string }
      current_seller_account_id: { Args: never; Returns: string }
      current_seller_status: {
        Args: never
        Returns: Database["public"]["Enums"]["seller_account_status"]
      }
      enqueue_order_notification: {
        Args: { p_event: string; p_order_id: string }
        Returns: undefined
      }
      finalize_order_stock: {
        Args: { p_order_id: string; p_outcome: string }
        Returns: undefined
      }
      finish_stock_reservation: {
        Args: { p_outcome: string; p_reservation_id: string }
        Returns: undefined
      }
      is_operator: { Args: never; Returns: boolean }
      jsonb_has_sensitive_account_key: {
        Args: { p_value: Json }
        Returns: boolean
      }
      ledger_account_for: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_kind: Database["public"]["Enums"]["ledger_account_kind"]
          p_seller_account_id?: string
        }
        Returns: string
      }
      post_ledger_transaction: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_event_key: string
          p_kind: string
          p_lines: Json
          p_metadata?: Json
          p_order_id?: string
          p_payout_request_id?: string
          p_reason?: string
          p_refund_id?: string
          p_seller_account_id?: string
        }
        Returns: string
      }
      record_creator_commission_payment: {
        Args: {
          p_commission_ids: string[]
          p_creator_id: string
          p_external_reference?: string
          p_method: string
          p_note?: string
        }
        Returns: Json
      }
      record_ledger_reconciliation: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_freeze_threshold_minor?: number
          p_provider_balance_minor: number
        }
        Returns: string
      }
      record_payment_subaccount_provider_result: {
        Args: {
          p_auth_user_id: string
          p_metadata: Json
          p_provider_id: string
          p_reservation_id: string
          p_seller_account_id: string
          p_subaccount_code: string
        }
        Returns: boolean
      }
      record_payout_transfer: {
        Args: {
          p_payout_id: string
          p_provider_status: string
          p_transfer_code: string
          p_transfer_id: string
        }
        Returns: boolean
      }
      refresh_discovery_listing: {
        Args: { p_shop_id: string }
        Returns: undefined
      }
      refresh_discovery_listings: { Args: never; Returns: number }
      release_abandoned_reservations: {
        Args: { p_limit?: number }
        Returns: {
          outcome: string
          reservation_id: string
        }[]
      }
      release_due_creator_commissions: { Args: never; Returns: number }
      release_due_order_settlements: { Args: never; Returns: number }
      release_payout_claim: {
        Args: { p_payout_id: string; p_reason: string }
        Returns: boolean
      }
      release_rate_limit: { Args: { p_key: string }; Returns: undefined }
      request_seller_payout: {
        Args: { p_amount_minor: number; p_idempotency_key?: string }
        Returns: string
      }
      reserve_payment_subaccount_request: {
        Args: {
          p_auth_user_id: string
          p_metadata: Json
          p_request_fingerprint: string
          p_seller_account_id: string
        }
        Returns: {
          provider_metadata: Json
          provider_subaccount_code: string
          provider_subaccount_id: string
          reservation_id: string
          reservation_status: string
        }[]
      }
      reserve_payout_destination: {
        Args: {
          p_account_last4: string
          p_bank_code: string
          p_bank_name: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_fingerprint: string
          p_seller_account_id: string
          p_type: string
        }
        Returns: {
          destination_id: string
          destination_status: string
        }[]
      }
      reserve_product_stock: {
        Args: {
          p_expires_at: string
          p_product_id: string
          p_quantity: number
          p_reference: string
          p_variant_id: string
        }
        Returns: string
      }
      respond_to_creator_commission_payment: {
        Args: { p_action: string; p_note?: string; p_payment_id: string }
        Returns: Json
      }
      run_internal_job: { Args: { p_path: string }; Returns: number }
      save_onboarding_shop: {
        Args: {
          p_display_name: string
          p_legal_name: string
          p_registration_number: string
          p_slug: string
        }
        Returns: string
      }
      seller_earnings_summary: {
        Args: Record<PropertyKey, never>
        Returns: {
          awaiting_payment_minor: number
          collected_offline_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          refunded_minor: number
          settled_online_minor: number
          total_paid_minor: number
        }[]
      }
      seller_analytics_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          checkout_starts: number
          distinct_buyers: number
          orders_placed: number
          paid_orders: number
          paid_total_minor: number
          product_views: number
          repeat_buyers: number
          visits: number
        }[]
      }
      seller_creator_commission_totals: {
        Args: Record<PropertyKey, never>
        Returns: {
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          paid_minor: number
          payable_minor: number
          pending_minor: number
          reversed_minor: number
        }[]
      }
      seller_payout_destination: {
        Args: { p_seller_account_id: string }
        Returns: {
          account_last4: string
          bank_name: string
          cooling_off: boolean
          destination_type: string
          resolved_account_name: string
        }[]
      }
      seller_product_profit: {
        Args: { p_from: string; p_to: string }
        Returns: {
          cost_minor: number
          product_id: string
          product_name: string
          profit_minor: number
          revenue_minor: number
          units_sold: number
        }[]
      }
      seller_product_profit_for: {
        Args: { p_from: string; p_product_id: string; p_to: string }
        Returns: {
          cost_minor: number
          product_id: string
          product_name: string
          profit_minor: number
          revenue_minor: number
          units_sold: number
        }[]
      }
      seller_top_products: {
        Args: { p_from: string; p_limit?: number; p_to: string }
        Returns: {
          product_id: string
          product_name: string
          revenue_minor: number
          units_sold: number
        }[]
      }
      seller_wallet_balance: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_seller_account_id: string
        }
        Returns: {
          available_minor: number
          pending_minor: number
          reserved_minor: number
        }[]
      }
      team_has_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["team_role"][]
          p_seller_account_id: string
        }
        Returns: boolean
      }
      webhook_signing_secret: {
        Args: { p_webhook_id: string }
        Returns: string
      }
      write_audit_event: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_type: Database["public"]["Enums"]["actor_type"]
          p_after_data?: Json
          p_before_data?: Json
          p_entity_id?: string
          p_entity_type: string
          p_metadata?: Json
        }
        Returns: string
      }
    }
    Enums: {
      actor_type: "system" | "user" | "seller" | "admin" | "provider"
      campaign_status: "draft" | "active" | "paused" | "ended"
      commission_status: "pending" | "payable" | "paid" | "reversed" | "void"
      consent_status: "pending" | "granted" | "withdrawn" | "expired"
      country_code: "GH" | "NG" | "CI"
      creator_status: "active" | "suspended" | "closed"
      currency_code: "GHS" | "NGN" | "XOF"
      discount_kind: "fixed" | "percentage"
      dispute_status:
        | "none"
        | "opened"
        | "seller_response_due"
        | "under_review"
        | "resolved"
        | "closed"
      domain_status: "pending" | "verified" | "failed" | "disabled"
      fulfillment_status:
        | "unconfirmed"
        | "confirmed"
        | "preparing"
        | "ready_for_pickup"
        | "dispatched"
        | "fulfilled"
        | "cancelled"
        | "returned"
      inventory_policy: "track" | "continue_selling" | "deny_when_out_of_stock"
      ledger_account_kind:
        | "processor_clearing"
        | "bank_settlement"
        | "processor_fees"
        | "platform_revenue"
        | "payout_fee_revenue"
        | "bad_debt"
        | "seller_pending"
        | "seller_available"
        | "seller_payout_reserved"
      ledger_normal_balance: "debit" | "credit"
      notification_status:
        | "pending"
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "read"
        | "dead_letter"
      order_status:
        | "draft"
        | "pending"
        | "confirmed"
        | "processing"
        | "completed"
        | "cancelled"
      partnership_status: "invited" | "active" | "paused" | "ended" | "declined"
      payment_status:
        | "unpaid"
        | "pending"
        | "paid"
        | "failed"
        | "partially_refunded"
        | "refunded"
        | "offline_due"
      payment_subaccount_status:
        | "pending"
        | "active"
        | "restricted"
        | "disabled"
      product_status: "draft" | "active" | "archived"
      refund_status:
        | "none"
        | "requested"
        | "processing"
        | "partial"
        | "completed"
        | "failed"
      review_status: "published" | "hidden"
      seller_account_status: "pending" | "active" | "suspended" | "closed"
      shop_status:
        | "draft"
        | "pending_review"
        | "published"
        | "suspended"
        | "closed"
      subscription_state:
        | "trialing"
        | "active"
        | "past_due"
        | "grace"
        | "cancelled"
        | "expired"
      team_role: "manager" | "catalog" | "fulfillment" | "support" | "analyst"
      verification_state:
        | "not_started"
        | "in_progress"
        | "needs_action"
        | "verified"
        | "rejected"
        | "suspended"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type: ["system", "user", "seller", "admin", "provider"],
      campaign_status: ["draft", "active", "paused", "ended"],
      commission_status: ["pending", "payable", "paid", "reversed", "void"],
      consent_status: ["pending", "granted", "withdrawn", "expired"],
      country_code: ["GH", "NG", "CI"],
      creator_status: ["active", "suspended", "closed"],
      currency_code: ["GHS", "NGN", "XOF"],
      discount_kind: ["fixed", "percentage"],
      dispute_status: [
        "none",
        "opened",
        "seller_response_due",
        "under_review",
        "resolved",
        "closed",
      ],
      domain_status: ["pending", "verified", "failed", "disabled"],
      fulfillment_status: [
        "unconfirmed",
        "confirmed",
        "preparing",
        "ready_for_pickup",
        "dispatched",
        "fulfilled",
        "cancelled",
        "returned",
      ],
      inventory_policy: ["track", "continue_selling", "deny_when_out_of_stock"],
      ledger_account_kind: [
        "processor_clearing",
        "bank_settlement",
        "processor_fees",
        "platform_revenue",
        "payout_fee_revenue",
        "bad_debt",
        "seller_pending",
        "seller_available",
        "seller_payout_reserved",
      ],
      ledger_normal_balance: ["debit", "credit"],
      notification_status: [
        "pending",
        "queued",
        "sent",
        "delivered",
        "failed",
        "read",
        "dead_letter",
      ],
      order_status: [
        "draft",
        "pending",
        "confirmed",
        "processing",
        "completed",
        "cancelled",
      ],
      partnership_status: ["invited", "active", "paused", "ended", "declined"],
      payment_status: [
        "unpaid",
        "pending",
        "paid",
        "failed",
        "partially_refunded",
        "refunded",
        "offline_due",
      ],
      payment_subaccount_status: [
        "pending",
        "active",
        "restricted",
        "disabled",
      ],
      product_status: ["draft", "active", "archived"],
      refund_status: [
        "none",
        "requested",
        "processing",
        "partial",
        "completed",
        "failed",
      ],
      review_status: ["published", "hidden"],
      seller_account_status: ["pending", "active", "suspended", "closed"],
      shop_status: [
        "draft",
        "pending_review",
        "published",
        "suspended",
        "closed",
      ],
      subscription_state: [
        "trialing",
        "active",
        "past_due",
        "grace",
        "cancelled",
        "expired",
      ],
      team_role: ["manager", "catalog", "fulfillment", "support", "analyst"],
      verification_state: [
        "not_started",
        "in_progress",
        "needs_action",
        "verified",
        "rejected",
        "suspended",
      ],
    },
  },
} as const
