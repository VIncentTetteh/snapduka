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
      ad_campaign_products: {
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
            foreignKeyName: "ad_campaign_products_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_products_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          bid_minor: number
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          created_by: string
          currency: Database["public"]["Enums"]["currency_code"]
          daily_budget_minor: number
          ended_at: string | null
          id: string
          name: string
          seller_account_id: string
          state: Database["public"]["Enums"]["ad_campaign_state"]
          updated_at: string
        }
        Insert: {
          bid_minor: number
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          created_by: string
          currency: Database["public"]["Enums"]["currency_code"]
          daily_budget_minor: number
          ended_at?: string | null
          id?: string
          name: string
          seller_account_id: string
          state?: Database["public"]["Enums"]["ad_campaign_state"]
          updated_at?: string
        }
        Update: {
          bid_minor?: number
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          created_by?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          daily_budget_minor?: number
          ended_at?: string | null
          id?: string
          name?: string
          seller_account_id?: string
          state?: Database["public"]["Enums"]["ad_campaign_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_clicks: {
        Row: {
          campaign_id: string
          click_date: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          ledger_transaction_id: string | null
          placement: string
          price_minor: number
          product_id: string
          seller_account_id: string
          viewer_key: string
        }
        Insert: {
          campaign_id: string
          click_date?: string
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          ledger_transaction_id?: string | null
          placement?: string
          price_minor: number
          product_id: string
          seller_account_id: string
          viewer_key: string
        }
        Update: {
          campaign_id?: string
          click_date?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          ledger_transaction_id?: string | null
          placement?: string
          price_minor?: number
          product_id?: string
          seller_account_id?: string
          viewer_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_clicks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_clicks_ledger_transaction_id_fkey"
            columns: ["ledger_transaction_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_clicks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_clicks_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_policies: {
        Row: {
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          max_bid_minor: number
          max_daily_budget_minor: number
          max_products_per_campaign: number
          min_bid_minor: number
          min_daily_budget_minor: number
          min_top_up_minor: number
          sponsored_slots: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          max_bid_minor: number
          max_daily_budget_minor: number
          max_products_per_campaign?: number
          min_bid_minor: number
          min_daily_budget_minor: number
          min_top_up_minor: number
          sponsored_slots?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          max_bid_minor?: number
          max_daily_budget_minor?: number
          max_products_per_campaign?: number
          min_bid_minor?: number
          min_daily_budget_minor?: number
          min_top_up_minor?: number
          sponsored_slots?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_policies_country_fkey"
            columns: ["country"]
            isOneToOne: true
            referencedRelation: "country_configs"
            referencedColumns: ["country"]
          },
        ]
      }
      ai_runs: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          context: Json
          cost_usd_micros: number
          created_at: string
          error: string | null
          id: string
          input_tokens: number
          latency_ms: number
          model: string
          outcome: string
          output_tokens: number
          purpose: string
          seller_account_id: string | null
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          context?: Json
          cost_usd_micros?: number
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number
          model: string
          outcome: string
          output_tokens?: number
          purpose: string
          seller_account_id?: string | null
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          context?: Json
          cost_usd_micros?: number
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          latency_ms?: number
          model?: string
          outcome?: string
          output_tokens?: number
          purpose?: string
          seller_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_seller_account_id_fkey"
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
      buyer_addresses: {
        Row: {
          area: string
          buyer_profile_id: string
          city: string
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          digital_address: string | null
          geo_source: string
          id: string
          label: string | null
          landmark: string | null
          lat: number | null
          line1: string
          lng: number | null
          region: string
          updated_at: string
        }
        Insert: {
          area?: string
          buyer_profile_id: string
          city: string
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          digital_address?: string | null
          geo_source?: string
          id?: string
          label?: string | null
          landmark?: string | null
          lat?: number | null
          line1: string
          lng?: number | null
          region?: string
          updated_at?: string
        }
        Update: {
          area?: string
          buyer_profile_id?: string
          city?: string
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          digital_address?: string | null
          geo_source?: string
          id?: string
          label?: string | null
          landmark?: string | null
          lat?: number | null
          line1?: string
          lng?: number | null
          region?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_addresses_buyer_profile_id_fkey"
            columns: ["buyer_profile_id"]
            isOneToOne: false
            referencedRelation: "buyer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_payment_methods: {
        Row: {
          buyer_profile_id: string
          card_last4: string | null
          created_at: string
          id: string
          last_used_at: string | null
          method: string
          momo_network: string | null
          msisdn_masked: string | null
          provider: string
          provider_token_sealed: string
        }
        Insert: {
          buyer_profile_id: string
          card_last4?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          method: string
          momo_network?: string | null
          msisdn_masked?: string | null
          provider: string
          provider_token_sealed: string
        }
        Update: {
          buyer_profile_id?: string
          card_last4?: string | null
          created_at?: string
          id?: string
          last_used_at?: string | null
          method?: string
          momo_network?: string | null
          msisdn_masked?: string | null
          provider?: string
          provider_token_sealed?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_payment_methods_buyer_profile_id_fkey"
            columns: ["buyer_profile_id"]
            isOneToOne: false
            referencedRelation: "buyer_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_profiles: {
        Row: {
          auth_user_id: string | null
          consent_shared_profile_at: string | null
          consent_version: string | null
          created_at: string
          default_address_id: string | null
          deleted_at: string | null
          display_name: string | null
          id: string
          locale: string
          phone_e164: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          consent_shared_profile_at?: string | null
          consent_version?: string | null
          created_at?: string
          default_address_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          locale?: string
          phone_e164?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          consent_shared_profile_at?: string | null
          consent_version?: string | null
          created_at?: string
          default_address_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          locale?: string
          phone_e164?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_profiles_default_address_id_fkey"
            columns: ["default_address_id"]
            isOneToOne: false
            referencedRelation: "buyer_addresses"
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
          delivery_margin_bps: number
          enabled: boolean
          instant_payout_fee_bps: number
          instant_payout_fee_min_minor: number
          minimum_payout_minor: number
          payout_auto_approve_max_minor: number
          payout_daily_cap_minor: number | null
          payout_fee_minor: number
          payout_hold_days: number
          payouts_enabled: boolean
          platform_fee_bps: number
          protect_auto_release_hours: number
          protect_courier_release_hours: number
          protect_dispatch_sla_hours: number
          protect_enabled: boolean
          protect_fee_bps: number
          protect_fee_cap_minor: number
          protect_fee_min_minor: number
          protect_float_cap_minor: number | null
          protect_inspection_hours: number
          protect_max_order_minor: number | null
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
          delivery_margin_bps?: number
          enabled?: boolean
          instant_payout_fee_bps?: number
          instant_payout_fee_min_minor?: number
          minimum_payout_minor?: number
          payout_auto_approve_max_minor?: number
          payout_daily_cap_minor?: number | null
          payout_fee_minor?: number
          payout_hold_days?: number
          payouts_enabled?: boolean
          platform_fee_bps?: number
          protect_auto_release_hours?: number
          protect_courier_release_hours?: number
          protect_dispatch_sla_hours?: number
          protect_enabled?: boolean
          protect_fee_bps?: number
          protect_fee_cap_minor?: number
          protect_fee_min_minor?: number
          protect_float_cap_minor?: number | null
          protect_inspection_hours?: number
          protect_max_order_minor?: number | null
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
          delivery_margin_bps?: number
          enabled?: boolean
          instant_payout_fee_bps?: number
          instant_payout_fee_min_minor?: number
          minimum_payout_minor?: number
          payout_auto_approve_max_minor?: number
          payout_daily_cap_minor?: number | null
          payout_fee_minor?: number
          payout_hold_days?: number
          payouts_enabled?: boolean
          platform_fee_bps?: number
          protect_auto_release_hours?: number
          protect_courier_release_hours?: number
          protect_dispatch_sla_hours?: number
          protect_enabled?: boolean
          protect_fee_bps?: number
          protect_fee_cap_minor?: number
          protect_fee_min_minor?: number
          protect_float_cap_minor?: number | null
          protect_inspection_hours?: number
          protect_max_order_minor?: number | null
          settlement_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      courier_connections: {
        Row: {
          active: boolean
          created_at: string
          credentials_secret_id: string | null
          id: string
          provider: string
          seller_account_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          credentials_secret_id?: string | null
          id?: string
          provider: string
          seller_account_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          credentials_secret_id?: string | null
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
          cache_key: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          eta_minutes: number | null
          expires_at: string
          id: string
          margin_minor: number
          order_id: string | null
          provider: string
          provider_quote_id: string | null
          seller_account_id: string
          service: string
          service_label: string | null
          shop_id: string | null
        }
        Insert: {
          amount_minor: number
          cache_key?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          eta_minutes?: number | null
          expires_at: string
          id?: string
          margin_minor?: number
          order_id?: string | null
          provider: string
          provider_quote_id?: string | null
          seller_account_id: string
          service: string
          service_label?: string | null
          shop_id?: string | null
        }
        Update: {
          amount_minor?: number
          cache_key?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          eta_minutes?: number | null
          expires_at?: string
          id?: string
          margin_minor?: number
          order_id?: string | null
          provider?: string
          provider_quote_id?: string | null
          seller_account_id?: string
          service?: string
          service_label?: string | null
          shop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_quotes_order_same_seller"
            columns: ["order_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "seller_account_id"]
          },
          {
            foreignKeyName: "courier_quotes_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_quotes_shop_same_seller"
            columns: ["shop_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id", "seller_account_id"]
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
          settled_by_payment_id: string | null
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
          settled_by_payment_id?: string | null
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
          settled_by_payment_id?: string | null
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
          {
            foreignKeyName: "creator_commission_adjustments_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "creator_commission_payments"
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
          ledger_accrual_txn_id: string | null
          ledger_clawed_back_minor: number
          ledger_pending_minor: number
          ledger_released_at: string | null
          ledger_released_minor: number
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
          settlement: string
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
          ledger_accrual_txn_id?: string | null
          ledger_clawed_back_minor?: number
          ledger_pending_minor?: number
          ledger_released_at?: string | null
          ledger_released_minor?: number
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
          settlement?: string
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
          ledger_accrual_txn_id?: string | null
          ledger_clawed_back_minor?: number
          ledger_pending_minor?: number
          ledger_released_at?: string | null
          ledger_released_minor?: number
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
          settlement?: string
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
            foreignKeyName: "creator_commissions_ledger_accrual_txn_id_fkey"
            columns: ["ledger_accrual_txn_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
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
      domain_events: {
        Row: {
          aggregate: string
          aggregate_id: string
          attempts: number
          claimed_until: string | null
          dedupe_key: string | null
          event_type: string
          id: number
          last_error: string | null
          occurred_at: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          aggregate: string
          aggregate_id: string
          attempts?: number
          claimed_until?: string | null
          dedupe_key?: string | null
          event_type: string
          id?: never
          last_error?: string | null
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          aggregate?: string
          aggregate_id?: string
          attempts?: number
          claimed_until?: string | null
          dedupe_key?: string | null
          event_type?: string
          id?: never
          last_error?: string | null
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
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
      feature_flags: {
        Row: {
          country_code: Database["public"]["Enums"]["country_code"] | null
          created_at: string
          enabled: boolean
          id: string
          key: string
          note: string | null
          percentage: number
          seller_account_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          country_code?: Database["public"]["Enums"]["country_code"] | null
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          note?: string | null
          percentage?: number
          seller_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          country_code?: Database["public"]["Enums"]["country_code"] | null
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          note?: string | null
          percentage?: number
          seller_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "country_configs"
            referencedColumns: ["country"]
          },
          {
            foreignKeyName: "feature_flags_seller_account_id_fkey"
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
      financing_advances: {
        Row: {
          accepted_at: string
          accepted_by: string
          closed_at: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          disbursed_at: string | null
          fee_minor: number
          fee_revenue_minor: number
          id: string
          offer_id: string
          partner: string
          partner_reference: string | null
          partner_share_minor: number
          platform_fee_share_minor: number
          principal_minor: number
          remitted_minor: number
          repaid_at: string | null
          seller_account_id: string
          state: Database["public"]["Enums"]["financing_advance_state"]
          state_reason: string | null
          sweep_bps: number
          swept_minor: number
          terms_version: string
          total_repayable_minor: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          closed_at?: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          disbursed_at?: string | null
          fee_minor: number
          fee_revenue_minor?: number
          id?: string
          offer_id: string
          partner: string
          partner_reference?: string | null
          partner_share_minor: number
          platform_fee_share_minor: number
          principal_minor: number
          remitted_minor?: number
          repaid_at?: string | null
          seller_account_id: string
          state?: Database["public"]["Enums"]["financing_advance_state"]
          state_reason?: string | null
          sweep_bps: number
          swept_minor?: number
          terms_version: string
          total_repayable_minor: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          closed_at?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          disbursed_at?: string | null
          fee_minor?: number
          fee_revenue_minor?: number
          id?: string
          offer_id?: string
          partner?: string
          partner_reference?: string | null
          partner_share_minor?: number
          platform_fee_share_minor?: number
          principal_minor?: number
          remitted_minor?: number
          repaid_at?: string | null
          seller_account_id?: string
          state?: Database["public"]["Enums"]["financing_advance_state"]
          state_reason?: string | null
          sweep_bps?: number
          swept_minor?: number
          terms_version?: string
          total_repayable_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_advances_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "financing_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_advances_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_offers: {
        Row: {
          accepted_at: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          eligibility: Json
          expires_at: string
          fee_bps: number
          fee_minor: number
          id: string
          partner: string
          platform_fee_share_minor: number
          principal_minor: number
          seller_account_id: string
          status: string
          sweep_bps: number
          terms_version: string
          total_repayable_minor: number
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          eligibility: Json
          expires_at: string
          fee_bps: number
          fee_minor: number
          id?: string
          partner: string
          platform_fee_share_minor?: number
          principal_minor: number
          seller_account_id: string
          status?: string
          sweep_bps: number
          terms_version: string
          total_repayable_minor: number
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          eligibility?: Json
          expires_at?: string
          fee_bps?: number
          fee_minor?: number
          id?: string
          partner?: string
          platform_fee_share_minor?: number
          principal_minor?: number
          seller_account_id?: string
          status?: string
          sweep_bps?: number
          terms_version?: string
          total_repayable_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_offers_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_policies: {
        Row: {
          country: Database["public"]["Enums"]["country_code"]
          created_at: string
          eligible_tiers: string[]
          enabled: boolean
          fee_bps: number
          max_chargeback_rate_bps: number
          max_offer_minor: number
          max_refund_rate_bps: number
          min_account_age_days: number
          min_gmv_90d_minor: number
          min_offer_minor: number
          min_orders_90d: number
          offer_gmv_bps: number
          offer_valid_days: number
          partner: string
          platform_fee_share_bps: number
          require_verified: boolean
          sweep_bps: number
          terms_version: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          country: Database["public"]["Enums"]["country_code"]
          created_at?: string
          eligible_tiers?: string[]
          enabled?: boolean
          fee_bps?: number
          max_chargeback_rate_bps?: number
          max_offer_minor: number
          max_refund_rate_bps?: number
          min_account_age_days?: number
          min_gmv_90d_minor: number
          min_offer_minor: number
          min_orders_90d?: number
          offer_gmv_bps?: number
          offer_valid_days?: number
          partner?: string
          platform_fee_share_bps?: number
          require_verified?: boolean
          sweep_bps?: number
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          country?: Database["public"]["Enums"]["country_code"]
          created_at?: string
          eligible_tiers?: string[]
          enabled?: boolean
          fee_bps?: number
          max_chargeback_rate_bps?: number
          max_offer_minor?: number
          max_refund_rate_bps?: number
          min_account_age_days?: number
          min_gmv_90d_minor?: number
          min_offer_minor?: number
          min_orders_90d?: number
          offer_gmv_bps?: number
          offer_valid_days?: number
          partner?: string
          platform_fee_share_bps?: number
          require_verified?: boolean
          sweep_bps?: number
          terms_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financing_policies_country_fkey"
            columns: ["country"]
            isOneToOne: true
            referencedRelation: "country_configs"
            referencedColumns: ["country"]
          },
        ]
      }
      financing_sweeps: {
        Row: {
          advance_id: string
          created_at: string
          id: string
          ledger_transaction_id: string | null
          release_minor: number
          seller_account_id: string
          shortfall_minor: number | null
          source_transaction_id: string
          swept_minor: number
          target_minor: number
        }
        Insert: {
          advance_id: string
          created_at?: string
          id?: string
          ledger_transaction_id?: string | null
          release_minor: number
          seller_account_id: string
          shortfall_minor?: number | null
          source_transaction_id: string
          swept_minor: number
          target_minor: number
        }
        Update: {
          advance_id?: string
          created_at?: string
          id?: string
          ledger_transaction_id?: string | null
          release_minor?: number
          seller_account_id?: string
          shortfall_minor?: number | null
          source_transaction_id?: string
          swept_minor?: number
          target_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financing_sweeps_advance_id_fkey"
            columns: ["advance_id"]
            isOneToOne: false
            referencedRelation: "financing_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_sweeps_ledger_transaction_id_fkey"
            columns: ["ledger_transaction_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_sweeps_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_sweeps_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: false
            referencedRelation: "ledger_transactions"
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
      kyc_checks: {
        Row: {
          check_type: string
          completed_at: string | null
          created_at: string
          expires_at: string | null
          failure_reason: string | null
          id: string
          masked_id: string | null
          match_score: number | null
          provider: string
          provider_ref: string
          result: Json
          seller_account_id: string
          status: string
          updated_at: string
        }
        Insert: {
          check_type: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          masked_id?: string | null
          match_score?: number | null
          provider: string
          provider_ref: string
          result?: Json
          seller_account_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          check_type?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          failure_reason?: string | null
          id?: string
          masked_id?: string | null
          match_score?: number | null
          provider?: string
          provider_ref?: string
          result?: Json
          seller_account_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_checks_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
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
          owner_creator_id: string | null
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
          owner_creator_id?: string | null
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
          owner_creator_id?: string | null
          owner_seller_account_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_owner_creator_id_fkey"
            columns: ["owner_creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
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
          creator_id: string | null
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
          creator_id?: string | null
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
          creator_id?: string | null
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
            foreignKeyName: "ledger_entries_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
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
          creator_id: string | null
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
          creator_id?: string | null
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
          creator_id?: string | null
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
            foreignKeyName: "ledger_transactions_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
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
      order_protections: {
        Row: {
          auto_release_at: string | null
          code_attempts: number
          code_issued_at: string | null
          code_locked_until: string | null
          confirmation_method: string | null
          courier_delivered_at: string | null
          delivery_code_hash: string | null
          delivery_confirmed_at: string | null
          dispatch_overdue_at: string | null
          dispatched_at: string | null
          disputed_at: string | null
          held_at: string
          inspection_ends_at: string | null
          order_id: string
          released_at: string | null
          resolution_note: string | null
          rider_token: string
          seller_account_id: string
          state: Database["public"]["Enums"]["protect_state"]
          state_before_dispute:
            | Database["public"]["Enums"]["protect_state"]
            | null
          updated_at: string
        }
        Insert: {
          auto_release_at?: string | null
          code_attempts?: number
          code_issued_at?: string | null
          code_locked_until?: string | null
          confirmation_method?: string | null
          courier_delivered_at?: string | null
          delivery_code_hash?: string | null
          delivery_confirmed_at?: string | null
          dispatch_overdue_at?: string | null
          dispatched_at?: string | null
          disputed_at?: string | null
          held_at?: string
          inspection_ends_at?: string | null
          order_id: string
          released_at?: string | null
          resolution_note?: string | null
          rider_token?: string
          seller_account_id: string
          state?: Database["public"]["Enums"]["protect_state"]
          state_before_dispute?:
            | Database["public"]["Enums"]["protect_state"]
            | null
          updated_at?: string
        }
        Update: {
          auto_release_at?: string | null
          code_attempts?: number
          code_issued_at?: string | null
          code_locked_until?: string | null
          confirmation_method?: string | null
          courier_delivered_at?: string | null
          delivery_code_hash?: string | null
          delivery_confirmed_at?: string | null
          dispatch_overdue_at?: string | null
          dispatched_at?: string | null
          disputed_at?: string | null
          held_at?: string
          inspection_ends_at?: string | null
          order_id?: string
          released_at?: string | null
          resolution_note?: string | null
          rider_token?: string
          seller_account_id?: string
          state?: Database["public"]["Enums"]["protect_state"]
          state_before_dispute?:
            | Database["public"]["Enums"]["protect_state"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_protections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_protections_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      order_settlements: {
        Row: {
          captured_at: string
          clawed_back_minor: number
          courier_charge_minor: number
          creator_commission_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          frozen_at: string | null
          frozen_reason: string | null
          gross_minor: number
          hold_days: number
          id: string
          order_id: string
          payment_attempt_id: string | null
          pending_minor: number
          platform_fee_bps: number
          platform_fee_minor: number
          protect_fee_minor: number
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
          courier_charge_minor?: number
          creator_commission_minor?: number
          currency: Database["public"]["Enums"]["currency_code"]
          frozen_at?: string | null
          frozen_reason?: string | null
          gross_minor: number
          hold_days: number
          id?: string
          order_id: string
          payment_attempt_id?: string | null
          pending_minor: number
          platform_fee_bps: number
          platform_fee_minor: number
          protect_fee_minor?: number
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
          courier_charge_minor?: number
          creator_commission_minor?: number
          currency?: Database["public"]["Enums"]["currency_code"]
          frozen_at?: string | null
          frozen_reason?: string | null
          gross_minor?: number
          hold_days?: number
          id?: string
          order_id?: string
          payment_attempt_id?: string | null
          pending_minor?: number
          platform_fee_bps?: number
          platform_fee_minor?: number
          protect_fee_minor?: number
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
          buyer_profile_id: string | null
          buyer_snapshot: Json
          campaign_snapshot: Json | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          delivery_address: Json | null
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
          protect_fee_minor: number
          protection_mode: string
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
          buyer_profile_id?: string | null
          buyer_snapshot: Json
          campaign_snapshot?: Json | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          customer_id: string
          delivery_address?: Json | null
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
          protect_fee_minor?: number
          protection_mode?: string
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
          buyer_profile_id?: string | null
          buyer_snapshot?: Json
          campaign_snapshot?: Json | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          customer_id?: string
          delivery_address?: Json | null
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
          protect_fee_minor?: number
          protection_mode?: string
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
            foreignKeyName: "orders_buyer_profile_id_fkey"
            columns: ["buyer_profile_id"]
            isOneToOne: false
            referencedRelation: "buyer_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_same_seller"
            columns: ["customer_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "seller_account_id"]
          },
          {
            foreignKeyName: "orders_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shop_same_seller"
            columns: ["shop_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id", "seller_account_id"]
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
          route_reason: string | null
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
          route_reason?: string | null
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
          route_reason?: string | null
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
      payment_disputes: {
        Row: {
          amount_minor: number
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          due_by: string | null
          id: string
          order_id: string
          provider: string
          provider_dispute_id: string
          provider_status: string | null
          raw: Json
          reserved_from: string | null
          seller_account_id: string
          seller_share_minor: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: Database["public"]["Enums"]["currency_code"]
          due_by?: string | null
          id?: string
          order_id: string
          provider?: string
          provider_dispute_id: string
          provider_status?: string | null
          raw?: Json
          reserved_from?: string | null
          seller_account_id: string
          seller_share_minor?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          due_by?: string | null
          id?: string
          order_id?: string
          provider?: string
          provider_dispute_id?: string
          provider_status?: string | null
          raw?: Json
          reserved_from?: string | null
          seller_account_id?: string
          seller_share_minor?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_disputes_seller_account_id_fkey"
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
          creator_id: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          id: string
          metadata: Json
          provider: string
          recipient_code: string | null
          request_fingerprint: string
          resolved_account_name: string | null
          revoked_at: string | null
          seller_account_id: string | null
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
          creator_id?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          id?: string
          metadata?: Json
          provider?: string
          recipient_code?: string | null
          request_fingerprint: string
          resolved_account_name?: string | null
          revoked_at?: string | null
          seller_account_id?: string | null
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
          creator_id?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          id?: string
          metadata?: Json
          provider?: string
          recipient_code?: string | null
          request_fingerprint?: string
          resolved_account_name?: string | null
          revoked_at?: string | null
          seller_account_id?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_destinations_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
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
          creator_id: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          destination: Json
          failure_reason: string | null
          fee_minor: number
          id: string
          idempotency_key: string | null
          net_minor: number | null
          not_before: string | null
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
          seller_account_id: string | null
          settle_ledger_txn_id: string | null
          speed: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          claimed_at?: string | null
          created_at?: string
          creator_id?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          destination?: Json
          failure_reason?: string | null
          fee_minor?: number
          id?: string
          idempotency_key?: string | null
          net_minor?: number | null
          not_before?: string | null
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
          seller_account_id?: string | null
          settle_ledger_txn_id?: string | null
          speed?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          claimed_at?: string | null
          created_at?: string
          creator_id?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          destination?: Json
          failure_reason?: string | null
          fee_minor?: number
          id?: string
          idempotency_key?: string | null
          net_minor?: number | null
          not_before?: string | null
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
          seller_account_id?: string | null
          settle_ledger_txn_id?: string | null
          speed?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
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
      provider_health: {
        Row: {
          attempts: number
          circuit_open_until: string | null
          country: Database["public"]["Enums"]["country_code"]
          failures: number
          provider: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempts?: number
          circuit_open_until?: string | null
          country: Database["public"]["Enums"]["country_code"]
          failures?: number
          provider: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          attempts?: number
          circuit_open_until?: string | null
          country?: Database["public"]["Enums"]["country_code"]
          failures?: number
          provider?: string
          updated_at?: string
          window_started_at?: string
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
          context: string | null
          created_at: string
          dedupe_key: string | null
          details: Json
          id: string
          rules_version: string | null
          score: number
          seller_account_id: string
          signal_type: string
          state: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          dedupe_key?: string | null
          details?: Json
          id?: string
          rules_version?: string | null
          score: number
          seller_account_id: string
          signal_type: string
          state?: string
        }
        Update: {
          context?: string | null
          created_at?: string
          dedupe_key?: string | null
          details?: Json
          id?: string
          rules_version?: string | null
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
          settlement_mode_override: string | null
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
          settlement_mode_override?: string | null
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
          settlement_mode_override?: string | null
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
      seller_digests: {
        Row: {
          channel: string | null
          created_at: string
          detail: string | null
          frequency: string
          id: string
          period_start: string
          seller_account_id: string
          status: string
        }
        Insert: {
          channel?: string | null
          created_at?: string
          detail?: string | null
          frequency: string
          id?: string
          period_start: string
          seller_account_id: string
          status: string
        }
        Update: {
          channel?: string | null
          created_at?: string
          detail?: string | null
          frequency?: string
          id?: string
          period_start?: string
          seller_account_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_digests_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
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
      seller_trust_scores: {
        Row: {
          components: Json
          computed_at: string
          score: number
          seller_account_id: string
          tier: string
          weights_version: string
        }
        Insert: {
          components: Json
          computed_at?: string
          score: number
          seller_account_id: string
          tier: string
          weights_version: string
        }
        Update: {
          components?: Json
          computed_at?: string
          score?: number
          seller_account_id?: string
          tier?: string
          weights_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_trust_scores_seller_account_id_fkey"
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
          booked_via: string
          charged_at: string | null
          courier_cost_minor: number | null
          created_at: string
          delivery_margin_minor: number | null
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
          booked_via?: string
          charged_at?: string | null
          courier_cost_minor?: number | null
          created_at?: string
          delivery_margin_minor?: number | null
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
          booked_via?: string
          charged_at?: string | null
          courier_cost_minor?: number | null
          created_at?: string
          delivery_margin_minor?: number | null
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
            foreignKeyName: "shipments_order_same_seller"
            columns: ["order_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "seller_account_id"]
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
      shop_pickup_addresses: {
        Row: {
          address: Json
          contact_phone: string | null
          created_at: string
          seller_account_id: string
          shop_id: string
          updated_at: string
        }
        Insert: {
          address: Json
          contact_phone?: string | null
          created_at?: string
          seller_account_id: string
          shop_id: string
          updated_at?: string
        }
        Update: {
          address?: Json
          contact_phone?: string | null
          created_at?: string
          seller_account_id?: string
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_pickup_addresses_shop_same_seller"
            columns: ["shop_id", "seller_account_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id", "seller_account_id"]
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
          slug_code: string
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
          slug_code?: string
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
          slug_code?: string
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
      sms_inbound_events: {
        Row: {
          action: string
          id: string
          keyword: string | null
          phone: string
          provider: string
          provider_message_id: string | null
          received_at: string
        }
        Insert: {
          action: string
          id?: string
          keyword?: string | null
          phone: string
          provider: string
          provider_message_id?: string | null
          received_at?: string
        }
        Update: {
          action?: string
          id?: string
          keyword?: string | null
          phone?: string
          provider?: string
          provider_message_id?: string | null
          received_at?: string
        }
        Relationships: []
      }
      sms_opt_outs: {
        Row: {
          created_at: string
          created_by: string | null
          keyword: string | null
          opted_in_at: string | null
          opted_out: boolean
          opted_out_at: string | null
          phone: string
          provider: string | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          keyword?: string | null
          opted_in_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone: string
          provider?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          keyword?: string | null
          opted_in_at?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          phone?: string
          provider?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
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
      wa_conversations: {
        Row: {
          agent_lock_until: string | null
          assigned_member_id: string | null
          buyer_phone: string
          created_at: string
          disclosed_at: string | null
          human_until: string | null
          id: string
          language: string | null
          last_inbound_at: string | null
          last_message_at: string
          last_message_preview: string
          last_outbound_at: string | null
          mode: string
          seller_account_id: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          agent_lock_until?: string | null
          assigned_member_id?: string | null
          buyer_phone: string
          created_at?: string
          disclosed_at?: string | null
          human_until?: string | null
          id?: string
          language?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string
          last_outbound_at?: string | null
          mode?: string
          seller_account_id?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          agent_lock_until?: string | null
          assigned_member_id?: string | null
          buyer_phone?: string
          created_at?: string
          disclosed_at?: string | null
          human_until?: string | null
          id?: string
          language?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string
          last_outbound_at?: string | null
          mode?: string
          seller_account_id?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "team_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_seller_account_id_fkey"
            columns: ["seller_account_id"]
            isOneToOne: false
            referencedRelation: "seller_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          agent_handled_at: string | null
          author: string
          author_user_id: string | null
          body: string
          conversation_id: string
          created_at: string
          direction: string
          error: string | null
          id: string
          media_id: string | null
          media_mime: string | null
          status: string
          template_name: string | null
          type: string
          wamid: string | null
        }
        Insert: {
          agent_handled_at?: string | null
          author: string
          author_user_id?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          media_id?: string | null
          media_mime?: string | null
          status: string
          template_name?: string | null
          type: string
          wamid?: string | null
        }
        Update: {
          agent_handled_at?: string | null
          author?: string
          author_user_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          media_id?: string | null
          media_mime?: string | null
          status?: string
          template_name?: string | null
          type?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          audience: string
          body: string
          category: string
          language: string
          meta_template_id: string | null
          name: string
          parameters: string[]
          status: string
          updated_at: string
        }
        Insert: {
          audience: string
          body: string
          category: string
          language?: string
          meta_template_id?: string | null
          name: string
          parameters?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          audience?: string
          body?: string
          category?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          parameters?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      accept_financing_offer: {
        Args: {
          p_accepted_by: string
          p_expected_total_minor: number
          p_offer_id: string
          p_seller_account_id: string
          p_terms_version: string
        }
        Returns: string
      }
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
      ad_campaign_spend_today: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      admin_creator_dispute_counts: {
        Args: never
        Returns: {
          creator_id: string
          disputes: number
        }[]
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
      admin_north_star: {
        Args: { p_weeks?: number }
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          gmv_minor: number
          paid_orders: number
          protect_fee_minor: number
          protect_gmv_minor: number
          protect_orders: number
          transacting_sellers: number
          week_start: string
        }[]
      }
      admin_order_totals_since: {
        Args: { p_since: string }
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          gmv_minor: number
          orders: number
          paid_orders: number
        }[]
      }
      admin_pending_payout_totals: {
        Args: never
        Returns: {
          amount_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          requests: number
        }[]
      }
      admin_plan_subscription_counts: {
        Args: Record<PropertyKey, never>
        Returns: { plan_id: string; subscriptions: number }[]
      }
      admin_seller_gmv: {
        Args: { p_seller_account_id: string }
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          gmv_minor: number
          paid_orders: number
        }[]
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
      ads_prepaid_balance: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_seller_account_id: string
        }
        Returns: number
      }
      ads_top_up: {
        Args: {
          p_amount_minor: number
          p_idempotency_key: string
          p_seller_account_id: string
        }
        Returns: string
      }
      ads_withdraw: {
        Args: {
          p_amount_minor: number
          p_idempotency_key: string
          p_seller_account_id: string
        }
        Returns: string
      }
      ai_spend_this_month: {
        Args: { p_seller_account_id: string }
        Returns: number
      }
      apply_kyc_result: {
        Args: {
          p_failure_reason?: string
          p_masked_id?: string
          p_match_score?: number
          p_provider: string
          p_provider_ref: string
          p_result?: Json
          p_status: string
        }
        Returns: Json
      }
      apply_paystack_dispute_event: {
        Args: { p_event: string; p_event_key: string; p_payload: Json }
        Returns: string
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
      bootstrap_buyer_profile: { Args: never; Returns: Json }
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
      buyer_link_orders: {
        Args: { p_order_ids: string[]; p_phone: string; p_profile_id: string }
        Returns: number
      }
      buyer_normalize_phone: {
        Args: { p_country: string; p_phone: string }
        Returns: string
      }
      buyer_order_history: {
        Args: { p_before?: string; p_limit?: number }
        Returns: {
          created_at: string
          currency: string
          fulfillment_status: string
          item_count: number
          order_id: string
          payment_status: string
          public_reference: string
          shop_name: string
          shop_slug: string
          status: string
          total_minor: number
          tracking_token: string
        }[]
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
      cancel_financing_advance: {
        Args: { p_advance_id: string; p_reason: string }
        Returns: undefined
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
      charge_courier_booking: {
        Args: { p_cost_minor: number; p_shipment_id: string }
        Returns: number
      }
      check_financial_product_invariants: {
        Args: never
        Returns: {
          check_name: string
          detail: string
        }[]
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
      claim_domain_events: {
        Args: { p_batch?: number; p_lease_seconds?: number }
        Returns: {
          aggregate: string
          aggregate_id: string
          attempts: number
          claimed_until: string | null
          dedupe_key: string | null
          event_type: string
          id: number
          last_error: string | null
          occurred_at: string
          payload: Json
          processed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "domain_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_guest_orders: { Args: never; Returns: Json }
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
      close_financing_advance: {
        Args: {
          p_advance_id: string
          p_reason: string
          p_state: Database["public"]["Enums"]["financing_advance_state"]
        }
        Returns: undefined
      }
      complete_domain_event: {
        Args: { p_error?: string; p_id: number }
        Returns: undefined
      }
      compute_seller_trust_scores: {
        Args: { p_after?: string; p_batch?: number }
        Returns: {
          last_seller_account_id: string
          processed: number
        }[]
      }
      confirm_delivery: {
        Args: { p_code: string; p_method: string; p_order_id: string }
        Returns: string
      }
      courier_booking_billable: {
        Args: { p_estimate_minor: number; p_order_id: string }
        Returns: boolean
      }
      courier_connection_credentials: {
        Args: { p_provider: string; p_seller_account_id: string }
        Returns: Json
      }
      create_ad_campaign: {
        Args: {
          p_bid_minor: number
          p_created_by: string
          p_daily_budget_minor: number
          p_name: string
          p_product_ids: string[]
          p_seller_account_id: string
        }
        Returns: string
      }
      create_financing_offer: {
        Args: { p_seller_account_id: string }
        Returns: string
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
      creator_commission_settlement_totals: {
        Args: { p_creator_id?: string }
        Returns: {
          clawed_back_minor: number
          commission_count: number
          creator_id: string
          currency: Database["public"]["Enums"]["currency_code"]
          paid_minor: number
          payable_minor: number
          pending_minor: number
          reversed_minor: number
          settlement: string
        }[]
      }
      creator_payout_destination: {
        Args: never
        Returns: {
          account_last4: string
          bank_name: string
          cooling_off: boolean
          currency: Database["public"]["Enums"]["currency_code"]
          destination_type: string
          resolved_account_name: string
        }[]
      }
      creator_wallet_balances: {
        Args: { p_creator_id?: string }
        Returns: {
          available_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          in_arrears: boolean
          pending_minor: number
          reserved_minor: number
        }[]
      }
      current_buyer_profile_id: { Args: never; Returns: string }
      current_creator_id: { Args: never; Returns: string }
      current_seller_account_id: { Args: never; Returns: string }
      current_seller_status: {
        Args: never
        Returns: Database["public"]["Enums"]["seller_account_status"]
      }
      draft_media_prune_candidates: {
        Args: { p_after?: string; p_limit?: number; p_min_age?: string }
        Returns: {
          name: string
        }[]
      }
      emit_domain_event: {
        Args: {
          p_aggregate: string
          p_aggregate_id: string
          p_dedupe_key?: string
          p_event_type: string
          p_payload?: Json
        }
        Returns: number
      }
      enqueue_creator_notification: {
        Args: {
          p_amount_minor?: number
          p_creator_id: string
          p_currency?: Database["public"]["Enums"]["currency_code"]
          p_dedupe_key?: string
          p_event: string
          p_seller_account_id: string
          p_shop_name: string
        }
        Returns: boolean
      }
      enqueue_order_notification: {
        Args: { p_event: string; p_order_id: string }
        Returns: undefined
      }
      evaluate_feature_flag: {
        Args: {
          p_country?: Database["public"]["Enums"]["country_code"]
          p_key: string
          p_seller_account_id?: string
        }
        Returns: boolean
      }
      export_buyer_data: { Args: never; Returns: Json }
      feature_flag_bucket: {
        Args: { p_key: string; p_subject: string }
        Returns: number
      }
      finalize_order_stock: {
        Args: { p_order_id: string; p_outcome: string }
        Returns: undefined
      }
      financing_eligibility: {
        Args: { p_seller_account_id: string }
        Returns: Json
      }
      financing_partner_amounts_due: {
        Args: never
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          due_minor: number
          partner: string
          partners: number
          remitted_minor: number
          transferred_minor: number
        }[]
      }
      finish_stock_reservation: {
        Args: { p_outcome: string; p_reservation_id: string }
        Returns: undefined
      }
      generate_slug_code: { Args: { p_length?: number }; Returns: string }
      is_operator: { Args: never; Returns: boolean }
      issue_delivery_code: { Args: { p_order_id: string }; Returns: string }
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
      ledger_account_for_creator: {
        Args: {
          p_creator_id: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_kind: Database["public"]["Enums"]["ledger_account_kind"]
        }
        Returns: string
      }
      link_order_to_buyer: {
        Args: { p_buyer_profile_id: string; p_order_id: string }
        Returns: Json
      }
      normalize_delivery_address: {
        Args: { p_address: Json; p_country: string }
        Returns: Json
      }
      post_creator_commission_accrual: {
        Args: { p_commission_id: string }
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
      protect_fee_for: {
        Args: {
          p_amount_minor: number
          p_country: Database["public"]["Enums"]["country_code"]
        }
        Returns: number
      }
      protect_mark_delivered: {
        Args: { p_method: string; p_order_id: string }
        Returns: undefined
      }
      protect_sweep: { Args: { p_batch?: number }; Returns: Json }
      provider_available: {
        Args: {
          p_country: Database["public"]["Enums"]["country_code"]
          p_provider: string
        }
        Returns: boolean
      }
      record_ad_click: {
        Args: {
          p_campaign_id: string
          p_placement?: string
          p_price_minor: number
          p_product_id: string
          p_viewer_key: string
        }
        Returns: string
      }
      record_courier_delivery: {
        Args: { p_order_id: string }
        Returns: boolean
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
      record_financing_disbursement: {
        Args: { p_advance_id: string; p_partner_reference: string }
        Returns: string
      }
      record_ledger_reconciliation: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_freeze_threshold_minor?: number
          p_provider_balance_minor: number
        }
        Returns: string
      }
      record_order_analytics_event: {
        Args: { p_dimensions?: Json; p_event_type: string; p_order_id: string }
        Returns: string
      }
      record_partner_settlement: {
        Args: {
          p_amount_minor: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_direction: string
          p_recorded_by?: string
          p_reference: string
        }
        Returns: string
      }
      record_payment_outcome: {
        Args: {
          p_country: Database["public"]["Enums"]["country_code"]
          p_provider: string
          p_success: boolean
        }
        Returns: undefined
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
      record_server_analytics_event: {
        Args: {
          p_dimensions?: Json
          p_event_type: string
          p_occurred_at?: string
          p_seller_account_id: string
          p_shop_id?: string
          p_subject_id: string
        }
        Returns: string
      }
      redact_domain_event_keys: {
        Args: { p_id: number; p_keys: string[] }
        Returns: undefined
      }
      refresh_ad_campaign_funding: {
        Args: {
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_seller_account_id: string
        }
        Returns: undefined
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
      release_creator_commission: {
        Args: { p_commission_id: string }
        Returns: boolean
      }
      release_due_creator_commissions: { Args: never; Returns: number }
      release_due_order_settlements: { Args: never; Returns: number }
      release_payout_claim: {
        Args: { p_payout_id: string; p_reason: string }
        Returns: boolean
      }
      release_rate_limit: { Args: { p_key: string }; Returns: undefined }
      remit_financing_payables: { Args: { p_limit?: number }; Returns: Json }
      request_buyer_deletion: { Args: { p_reason?: string }; Returns: Json }
      request_creator_payout: {
        Args: { p_amount_minor: number; p_idempotency_key?: string }
        Returns: string
      }
      request_seller_payout:
        | {
            Args: { p_amount_minor: number; p_idempotency_key?: string }
            Returns: string
          }
        | {
            Args: {
              p_amount_minor: number
              p_idempotency_key: string
              p_speed: string
            }
            Returns: string
          }
      reserve_creator_payout_destination: {
        Args: {
          p_account_last4: string
          p_bank_code: string
          p_bank_name: string
          p_creator_id: string
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_fingerprint: string
          p_type: string
        }
        Returns: {
          destination_id: string
          destination_status: string
        }[]
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
      resolve_protect_dispute: {
        Args: {
          p_note: string
          p_operator_user_id: string
          p_order_id: string
          p_outcome: string
        }
        Returns: string
      }
      respond_to_creator_commission_payment: {
        Args: { p_action: string; p_note?: string; p_payment_id: string }
        Returns: Json
      }
      reverse_ledger_creator_commission: {
        Args: {
          p_commission_id: string
          p_new_amount: number
          p_new_basis: number
          p_reason: string
        }
        Returns: string
      }
      run_internal_job: { Args: { p_path: string }; Returns: number }
      run_seller_trust_scores: {
        Args: { p_batch?: number; p_max_batches?: number }
        Returns: number
      }
      save_onboarding_shop: {
        Args: {
          p_display_name: string
          p_legal_name: string
          p_registration_number: string
        }
        Returns: string
      }
      seller_account_operable: {
        Args: { p_seller_account_id: string }
        Returns: boolean
      }
      seller_ad_campaign_stats: {
        Args: { p_seller_account_id: string }
        Returns: {
          campaign_id: string
          clicks_today: number
          clicks_total: number
          spent_today_minor: number
          spent_total_minor: number
        }[]
      }
      seller_digest_due: {
        Args: {
          p_after?: string
          p_frequency: string
          p_limit?: number
          p_period_start: string
        }
        Returns: {
          contact_phone: string
          currency: Database["public"]["Enums"]["currency_code"]
          seller_account_id: string
          shop_name: string
        }[]
      }
      seller_digest_summary: {
        Args: { p_from: string; p_seller_account_id: string; p_to: string }
        Returns: {
          orders_count: number
          paid_revenue_minor: number
          to_fulfil: number
          unread_conversations: number
        }[]
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
          owed_now_minor: number
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
      seller_settlement_mode: {
        Args: { p_seller_account_id: string }
        Returns: string
      }
      seller_sms_suppressed_count: {
        Args: { p_seller_account_id: string }
        Returns: number
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
      set_buyer_shared_profile_consent: {
        Args: { p_granted: boolean; p_version?: string }
        Returns: Json
      }
      set_courier_connection_credentials: {
        Args: {
          p_credentials: Json
          p_provider: string
          p_seller_account_id: string
        }
        Returns: string
      }
      set_order_protection: {
        Args: {
          p_enabled: boolean
          p_order_id: string
          p_tracking_token: string
        }
        Returns: Json
      }
      set_product_category: {
        Args: { p_category_id: string; p_product_id: string }
        Returns: undefined
      }
      settle_courier_payable: {
        Args: {
          p_amount_minor: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_operator_user_id: string
          p_reference: string
        }
        Returns: string
      }
      shop_slug_base: { Args: { p_display_name: string }; Returns: string }
      sms_apply_opt_keyword: {
        Args: {
          p_action: string
          p_actor?: string
          p_keyword?: string
          p_phone: string
          p_provider?: string
          p_provider_message_id?: string
          p_source: string
        }
        Returns: {
          consents_withdrawn: number
          duplicate: boolean
          opted_out: boolean
        }[]
      }
      sms_suppressed_phones: {
        Args: { p_phones: string[] }
        Returns: {
          phone: string
        }[]
      }
      sponsored_listings: {
        Args: {
          p_country: Database["public"]["Enums"]["country_code"]
          p_limit?: number
        }
        Returns: {
          bid_minor: number
          campaign_id: string
          cost_per_click_minor: number
          currency: Database["public"]["Enums"]["currency_code"]
          image_path: string
          price_minor: number
          product_id: string
          product_name: string
          seller_account_id: string
          shop_name: string
          shop_slug: string
        }[]
      }
      start_kyc_check: {
        Args: {
          p_check_type: string
          p_expires_at?: string
          p_provider: string
          p_provider_ref: string
          p_seller_account_id: string
        }
        Returns: string
      }
      suggest_price: {
        Args: {
          p_category_id: string
          p_country: Database["public"]["Enums"]["country_code"]
        }
        Returns: {
          currency: Database["public"]["Enums"]["currency_code"]
          median_minor: number
          p25_minor: number
          p75_minor: number
          sample_size: number
        }[]
      }
      sweep_financing_repayments: { Args: { p_limit?: number }; Returns: Json }
      team_has_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["team_role"][]
          p_seller_account_id: string
        }
        Returns: boolean
      }
      update_ad_campaign: {
        Args: {
          p_action: string
          p_bid_minor?: number
          p_campaign_id: string
          p_daily_budget_minor?: number
          p_seller_account_id: string
        }
        Returns: Database["public"]["Enums"]["ad_campaign_state"]
      }
      validate_ad_campaign_terms: {
        Args: {
          p_bid_minor: number
          p_country: Database["public"]["Enums"]["country_code"]
          p_daily_budget_minor: number
        }
        Returns: undefined
      }
      wa_apply_status: {
        Args: { p_error?: string; p_status: string; p_wamid: string }
        Returns: boolean
      }
      wa_claim_conversation: {
        Args: { p_conversation_id: string; p_lease_seconds?: number }
        Returns: boolean
      }
      wa_find_shop_in_text: { Args: { p_text: string }; Returns: string }
      wa_record_inbound: {
        Args: {
          p_body: string
          p_from: string
          p_media_id?: string
          p_media_mime?: string
          p_sent_at?: string
          p_type: string
          p_wamid: string
        }
        Returns: {
          conversation_id: string
          duplicate: boolean
          message_id: string
          newly_bound: boolean
          seller_account_id: string
        }[]
      }
      wa_record_outbound: {
        Args: {
          p_author: string
          p_author_user_id?: string
          p_body: string
          p_buyer_phone: string
          p_conversation_id?: string
          p_error?: string
          p_seller_account_id?: string
          p_status: string
          p_template_name?: string
          p_type: string
          p_wamid?: string
        }
        Returns: string
      }
      wa_release_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      webhook_signing_secret: {
        Args: { p_webhook_id: string }
        Returns: string
      }
      whatsapp_platform_secrets: {
        Args: never
        Returns: {
          access_token: string
          app_secret: string
          verify_token: string
        }[]
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
      write_off_seller_debt: {
        Args: {
          p_amount_minor: number
          p_currency: Database["public"]["Enums"]["currency_code"]
          p_idempotency_key: string
          p_operator_user_id: string
          p_reason: string
          p_seller_account_id: string
        }
        Returns: string
      }
    }
    Enums: {
      actor_type: "system" | "user" | "seller" | "admin" | "provider"
      ad_campaign_state: "active" | "paused" | "out_of_funds" | "ended"
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
      financing_advance_state:
        | "accepted"
        | "disbursed"
        | "repaying"
        | "repaid"
        | "cancelled"
        | "defaulted"
        | "written_off"
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
        | "protect_fee_revenue"
        | "seller_dispute_reserve"
        | "courier_payable"
        | "delivery_margin_revenue"
        | "financing_payable"
        | "partner_clearing"
        | "financing_fee_revenue"
        | "ads_prepaid"
        | "ads_revenue"
        | "creator_pending"
        | "creator_available"
        | "creator_payout_reserved"
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
      protect_state:
        | "held"
        | "in_transit"
        | "releasable"
        | "released"
        | "disputed"
        | "refunded"
        | "cancelled"
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
      ad_campaign_state: ["active", "paused", "out_of_funds", "ended"],
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
      financing_advance_state: [
        "accepted",
        "disbursed",
        "repaying",
        "repaid",
        "cancelled",
        "defaulted",
        "written_off",
      ],
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
        "protect_fee_revenue",
        "seller_dispute_reserve",
        "courier_payable",
        "delivery_margin_revenue",
        "creator_pending",
        "creator_available",
        "creator_payout_reserved",
        "financing_payable",
        "partner_clearing",
        "financing_fee_revenue",
        "ads_prepaid",
        "ads_revenue",
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
      protect_state: [
        "held",
        "in_transit",
        "releasable",
        "released",
        "disputed",
        "refunded",
        "cancelled",
      ],
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
