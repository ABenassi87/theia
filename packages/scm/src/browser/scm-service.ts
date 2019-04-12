/********************************************************************************
 * Copyright (C) 2019 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
import { Disposable, DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { injectable } from 'inversify';
import URI from '@theia/core/lib/common/uri';

export interface ScmProvider extends Disposable {
    readonly label: string;
    readonly id: string;
    readonly handle: number;
    readonly contextValue: string;

    readonly groups: ScmResourceGroup[];

    readonly onDidChangeResources: Event<void>;

    readonly rootUri?: string;
    readonly onDidChangeCommitTemplate?: Event<string>;
    readonly onDidChangeStatusBarCommands?: Event<ScmCommand[]>;
    readonly acceptInputCommand?: ScmCommand;
    readonly onDidChange: Event<void>;
}

export interface ScmResourceGroup {
    readonly handle: number,
    readonly sourceControlHandle: number,
    readonly resources: ScmResource[];
    readonly provider: ScmProvider;
    readonly label: string;
    readonly id: string;
    readonly onDidChange: Event<void>;
}

export interface ScmResource {
    readonly handle: number;
    readonly groupHandle: number;
    readonly sourceControlHandle: number;
    readonly group: ScmResourceGroup;
    readonly sourceUri: URI;
    readonly decorations?: ScmResourceDecorations;
    readonly selected?: boolean;

    open(): Promise<void>;
}

export interface ScmResourceDecorations {
    icon?: string;
    tooltip?: string;
    source?: string;
    letter?: string;
    color?: string;
}

export interface ScmCommand {
    id: string;
    text: string;
    tooltip?: string;
    command?: string;
}

export interface InputValidation {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
}

export interface InputValidator {
    (value: string): Promise<InputValidation | undefined>;
}

export namespace InputValidator {
    /**
     * Type for the validation result with a status and a corresponding message.
     */
    export type Result = Readonly<{ message: string, type: 'info' | 'success' | 'warning' | 'error' }>;

    export namespace Result {

        /**
         * `true` if the `message` and the `status` properties are the same on both `left` and `right`. Or both arguments are `undefined`. Otherwise, `false`.
         */
        export function equal(left: Result | undefined, right: Result | undefined): boolean {
            if (left && right) {
                return left.message === right.message && left.type === right.type;
            }
            return left === right;
        }

    }
}

export interface ScmInput {
    value: string;
    readonly onDidChange: Event<string>;

    placeholder: string;
    readonly onDidChangePlaceholder: Event<string>;

    validateInput: InputValidator;
    readonly onDidChangeValidateInput: Event<void>;

    visible: boolean;
    readonly onDidChangeVisibility: Event<boolean>;
}

export interface ScmRepository extends Disposable {
    readonly onDidFocus: Event<void>;
    readonly selected: boolean;
    readonly onDidChangeSelection: Event<boolean>;
    readonly provider: ScmProvider;
    readonly input: ScmInput;

    focus(): void;

    setSelected(selected: boolean): void;
}

@injectable()
export class ScmService {
    private providerIds = new Set<string>();
    private _repositories: ScmRepository[] = [];
    private _selectedRepository: ScmRepository | undefined;

    private disposableCollection: DisposableCollection = new DisposableCollection();
    private onDidChangeSelectedRepositoriesEmitter = new Emitter<ScmRepository | undefined>();
    private onDidAddProviderEmitter = new Emitter<ScmRepository>();
    private onDidRemoveProviderEmitter = new Emitter<ScmRepository>();

    readonly onDidChangeSelectedRepositories: Event<ScmRepository | undefined> = this.onDidChangeSelectedRepositoriesEmitter.event;

    constructor() {
        this.disposableCollection.push(this.onDidChangeSelectedRepositoriesEmitter);
        this.disposableCollection.push(this.onDidAddProviderEmitter);
        this.disposableCollection.push(this.onDidRemoveProviderEmitter);
    }

    get repositories(): ScmRepository[] {
        return [...this._repositories];
    }

    get selectedRepository(): ScmRepository | undefined {
        return this._selectedRepository;
    }

    set selectedRepository(repository: ScmRepository | undefined) {
        this._selectedRepository = repository;
        this.onDidChangeSelectedRepositoriesEmitter.fire(repository);
    }

    get onDidAddRepository(): Event<ScmRepository> {
        return this.onDidAddProviderEmitter.event;
    }

    get onDidRemoveRepository(): Event<ScmRepository> {
        return this.onDidRemoveProviderEmitter.event;
    }

    registerScmProvider(provider: ScmProvider): ScmRepository {

        if (this.providerIds.has(provider.id)) {
            throw new Error(`SCM Provider ${provider.id} already exists.`);
        }

        this.providerIds.add(provider.id);

        const disposable: Disposable = Disposable.create(() => {
            const index = this._repositories.indexOf(repository);
            if (index < 0) {
                return;
            }
            this.providerIds.delete(provider.id);
            this._repositories.splice(index, 1);
            this.onDidRemoveProviderEmitter.fire(repository);
        });

        const repository = new ScmRepositoryImpl(provider, disposable);

        this._repositories.push(repository);
        this.onDidAddProviderEmitter.fire(repository);

        // automatically select the first repository
        if (this._repositories.length === 1) {
            this.selectedRepository = repository;
        }

        return repository;
    }

    dispose(): void {
        this.disposableCollection.dispose();
    }
}

class ScmRepositoryImpl implements ScmRepository {

    private onDidFocusEmitter = new Emitter<void>();
    readonly onDidFocus: Event<void> = this.onDidFocusEmitter.event;

    private _selected = false;
    get selected(): boolean {
        return this._selected;
    }

    private onDidChangeSelectionEmitter = new Emitter<boolean>();
    readonly onDidChangeSelection: Event<boolean> = this.onDidChangeSelectionEmitter.event;

    readonly input: ScmInput = new ScmInputImpl();

    constructor(
        public readonly provider: ScmProvider,
        private disposable: Disposable
    ) { }

    focus(): void {
        this.onDidFocusEmitter.fire(undefined);
    }

    setSelected(selected: boolean): void {
        this._selected = selected;
        this.onDidChangeSelectionEmitter.fire(selected);
    }

    dispose(): void {
        this.disposable.dispose();
        this.provider.dispose();
    }
}

class ScmInputImpl implements ScmInput {

    private _value = '';
    private _placeholder = '';
    private _visible = true;
    private _validateInput: InputValidator = () => Promise.resolve(undefined);
    private onDidChangePlaceholderEmitter = new Emitter<string>();
    private onDidChangeVisibilityEmitter = new Emitter<boolean>();
    private onDidChangeValidateInputEmitter = new Emitter<void>();
    private onDidChangeEmitter = new Emitter<string>();

    get value(): string {
        return this._value;
    }

    set value(value: string) {
        if (this._value === value) {
            return;
        }
        this._value = value;
        this.onDidChangeEmitter.fire(value);
    }

    get onDidChange(): Event<string> {
        return this.onDidChangeEmitter.event;
    }

    get placeholder(): string {
        return this._placeholder;
    }

    set placeholder(placeholder: string) {
        this._placeholder = placeholder;
        this.onDidChangePlaceholderEmitter.fire(placeholder);
    }

    get onDidChangePlaceholder(): Event<string> {
        return this.onDidChangePlaceholderEmitter.event;
    }

    get visible(): boolean {
        return this._visible;
    }

    set visible(visible: boolean) {
        this._visible = visible;
        this.onDidChangeVisibilityEmitter.fire(visible);
    }

    get onDidChangeVisibility(): Event<boolean> {
        return this.onDidChangeVisibilityEmitter.event;
    }

    get validateInput(): InputValidator {
        return this._validateInput;
    }

    set validateInput(validateInput: InputValidator) {
        this._validateInput = validateInput;
        this.onDidChangeValidateInputEmitter.fire(undefined);
    }

    get onDidChangeValidateInput(): Event<void> {
        return this.onDidChangeValidateInputEmitter.event;
    }
}
