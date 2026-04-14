'use client';

import { Input } from '@/components/ui/input';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import {
  type AgentFormChangeHandler,
  type AgentFormState,
  DEFAULT_AGENT_MAX_STEPS,
  normalizeAgentMaxSteps,
} from './agent-form';

const DELIVERY_MODE_OPTIONS: AgentFormState['deliveryMode'][] = ['chat', 'workspace'];

interface AgentFormFieldsProps {
  form: AgentFormState;
  idPrefix: string;
  promptRows?: number;
  skillOptions?: MultiSelectOption[];
  mcpOptions?: MultiSelectOption[];
  onChange: AgentFormChangeHandler;
}

export function AgentFormFields({
  form,
  idPrefix,
  promptRows = 8,
  skillOptions = [],
  mcpOptions = [],
  onChange,
}: AgentFormFieldsProps) {
  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-name`} className="text-sm text-muted-foreground">
          Name
        </label>
        <Input
          id={`${idPrefix}-name`}
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-description`} className="text-sm text-muted-foreground">
          Description
        </label>
        <Textarea
          id={`${idPrefix}-description`}
          rows={3}
          value={form.description}
          onChange={(event) => onChange('description', event.target.value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={`${idPrefix}-delivery`} className="text-sm text-muted-foreground">
            Delivery Mode
          </label>
          <Select
            value={form.deliveryMode}
            onValueChange={(value) =>
              onChange('deliveryMode', value as AgentFormState['deliveryMode'])
            }
          >
            <SelectTrigger id={`${idPrefix}-delivery`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_MODE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label htmlFor={`${idPrefix}-steps`} className="text-sm text-muted-foreground">
            Max Steps
          </label>
          <Input
            id={`${idPrefix}-steps`}
            type="number"
            min={1}
            max={100}
            value={form.maxSteps}
            onChange={(event) =>
              onChange(
                'maxSteps',
                normalizeAgentMaxSteps(Number(event.target.value || DEFAULT_AGENT_MAX_STEPS))
              )
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-prompt`} className="text-sm text-muted-foreground">
          System Prompt
        </label>
        <Textarea
          id={`${idPrefix}-prompt`}
          rows={promptRows}
          value={form.systemPrompt}
          onChange={(event) => onChange('systemPrompt', event.target.value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: MultiSelect is a custom composite widget */}
          <label className="text-sm text-muted-foreground">Skills</label>
          <MultiSelect
            options={skillOptions}
            selected={form.skills}
            onChange={(values) => onChange('skills', values)}
            placeholder="Select skills..."
            emptyText="No skills available."
          />
        </div>

        <div className="space-y-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: MultiSelect is a custom composite widget */}
          <label className="text-sm text-muted-foreground">MCP Servers</label>
          <MultiSelect
            options={mcpOptions}
            selected={form.mcpServers}
            onChange={(values) => onChange('mcpServers', values)}
            placeholder="Select MCP servers..."
            emptyText="No MCP servers available."
          />
        </div>
      </div>
    </div>
  );
}
