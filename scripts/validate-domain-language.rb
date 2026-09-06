#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"

def usage(program)
  warn "Usage: #{program} [repository-root]"
  exit 2
end

def base_error(message)
  warn "Domain-language check: #{message}"
  exit 2
end

def present_string?(value)
  value.is_a?(String) && !value.strip.empty?
end

def normalized(value)
  value.strip.downcase
end

usage($PROGRAM_NAME) if ARGV.length > 1

repository_root = File.expand_path(ARGV.fetch(0, Dir.pwd))
base_error("repository root does not exist: #{repository_root}") unless File.directory?(repository_root)

domain_directory = File.join(repository_root, "docs", "domain")
registry_path = File.join(domain_directory, "ubiquitous-language.yml")
base_error("missing docs/domain directory") unless File.directory?(domain_directory)
base_error("missing docs/domain/ubiquitous-language.yml") unless File.file?(registry_path)

begin
  registry = YAML.safe_load_file(
    registry_path,
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )
rescue Psych::Exception => error
  warn "Domain-language check: invalid YAML: #{error.message.lines.first.strip}"
  exit 1
rescue SystemCallError => error
  base_error("cannot read docs/domain/ubiquitous-language.yml: #{error.message}")
end

errors = []
add_error = lambda do |message|
  errors << message
end

unless registry.is_a?(Hash)
  add_error.call("root must be a mapping")
  registry = {}
end

version = registry["version"]
add_error.call("version must be a positive integer") unless version.is_a?(Integer) && version.positive?

domain = registry["domain"]
unless domain.is_a?(Hash)
  add_error.call("domain must be a mapping")
  domain = {}
end

%w[name purpose].each do |field|
  add_error.call("domain.#{field} must be a non-empty string") unless present_string?(domain[field])
end

contexts = registry["bounded_contexts"]
unless contexts.is_a?(Array) && !contexts.empty?
  add_error.call("bounded_contexts must be a non-empty sequence")
  contexts = []
end

context_ids = {}
contexts.each_with_index do |context, index|
  location = "bounded_contexts[#{index}]"
  unless context.is_a?(Hash)
    add_error.call("#{location} must be a mapping")
    next
  end

  %w[id name definition].each do |field|
    add_error.call("#{location}.#{field} must be a non-empty string") unless present_string?(context[field])
  end

  context_id = context["id"]
  next unless present_string?(context_id)

  unless context_id.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/)
    add_error.call("#{location}.id must use kebab-case")
  end
  if context_ids.key?(context_id)
    add_error.call("duplicate bounded context id: #{context_id}")
  else
    context_ids[context_id] = index
  end
end

terms = registry["terms"]
unless terms.is_a?(Array) && !terms.empty?
  add_error.call("terms must be a non-empty sequence")
  terms = []
end

canonical_terms = {}
valid_terms = []
terms.each_with_index do |term_entry, index|
  location = "terms[#{index}]"
  unless term_entry.is_a?(Hash)
    add_error.call("#{location} must be a mapping")
    next
  end

  %w[context term definition].each do |field|
    add_error.call("#{location}.#{field} must be a non-empty string") unless present_string?(term_entry[field])
  end

  context_id = term_entry["context"]
  term = term_entry["term"]
  if present_string?(context_id) && !context_ids.key?(context_id)
    add_error.call("#{location}.context references unknown bounded context: #{context_id}")
  end

  next unless present_string?(context_id) && present_string?(term)

  key = [context_id, normalized(term)]
  if canonical_terms.key?(key)
    add_error.call("duplicate term in #{context_id}: #{term}")
  else
    canonical_terms[key] = index
  end
  valid_terms << [term_entry, index, context_id, term]
end

avoid_owners = {}
valid_terms.each do |term_entry, index, context_id, term|
  next unless term_entry.key?("avoid")

  location = "terms[#{index}].avoid"
  avoid_values = term_entry["avoid"]
  unless avoid_values.is_a?(Array) && !avoid_values.empty?
    add_error.call("#{location} must be a non-empty sequence of strings")
    next
  end

  avoid_values.each_with_index do |avoid_value, avoid_index|
    unless present_string?(avoid_value)
      add_error.call("#{location}[#{avoid_index}] must be a non-empty string")
      next
    end

    avoid_key = [context_id, normalized(avoid_value)]
    if canonical_terms.key?(avoid_key)
      add_error.call("avoid value conflicts with a canonical term in #{context_id}: #{avoid_value}")
    end

    previous_owner = avoid_owners[avoid_key]
    if previous_owner
      add_error.call("avoid value maps to both #{previous_owner} and #{term} in #{context_id}: #{avoid_value}")
    else
      avoid_owners[avoid_key] = term
    end
  end
end

unless errors.empty?
  errors.each { |message| warn "Domain-language check: #{message}" }
  warn "Domain-language check failed with #{errors.length} error(s)."
  exit 1
end

puts "Domain-language check passed: #{contexts.length} context(s), #{terms.length} term(s)."
